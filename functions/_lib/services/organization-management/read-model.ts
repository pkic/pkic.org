import { hostWithinDomainSql } from "../../email-domains/sql";
/**
 * Organization-management read model — list/detail projections over the
 * post-approval organization profile (data-bearing columns, pulled forward
 * by consolidated migration 0035) plus its acting-identity roster
 * (`identities`, consolidated migration 0035). Split from the combined
 * prior combined organization module (PR #1 review, Phase 8) — see profile-update.ts for the
 * profile-update use case and identity lifecycle commands
 * provisioning; this file owns only reads.
 */
import { all, first } from "../../db/queries";
import { buildOffsetPageStatements, decodeOffsetPageResults } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { AppError } from "../../errors";
import { resolveMappedOrderBy } from "../../db/sort";
import { memberProfileHref } from "../../../../assets/shared/member-profile-url";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import {
  ORGANIZATIONS_SORT_COLUMNS,
  type OrganizationsListQuery,
} from "../../../../assets/shared/schemas/organization-management";
import { primaryContactProjection, resolveRepresentativeRoleHolders } from "../membership/representative-roles";
import { toOrganizationExtendedContent, toOrganizationSummaryContent } from "../organization-content/fields";
import { nowIso } from "../../utils/time";
import { publicUserHeadshotPath } from "../user-headshot";
import type { DatabaseLike } from "../../types";
import { identityOrganizationEmailDomainSql } from "../identities/affiliation-projection";

export async function getOrgAggregate(
  db: DatabaseLike,
  organizationId: string,
): Promise<{ id: string; categoryCode: string | null } | null> {
  return first<{ id: string; categoryCode: string | null }>(
    db,
    `SELECT m.id AS id, mca.category_code AS categoryCode
     FROM members m LEFT JOIN member_category_assignments mca ON mca.member_id = m.id
     WHERE m.organization_id = ?`,
    [organizationId],
  );
}

// ── List ─────────────────────────────────────────────────────────────────

interface OrgSummaryRow {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  slogan: string | null;
  logo_r2_key: string | null;
  member_since: string | null;
  membership_category: string | null;
  created_at: string;
  updated_at: string;
  active_identity_count: number;
  primary_contact_user_id: string | null;
  primary_contact_first_name: string | null;
  primary_contact_last_name: string | null;
  primary_contact_email: string | null;
  slug: string | null;
}

const ORG_SUMMARY_SELECT = `
  SELECT o.id, o.name, o.slug, o.website, o.description, o.slogan, o.logo_r2_key, m.member_since,
         o.created_at, o.updated_at,
         mca.category_code AS membership_category,
         (SELECT COUNT(*) FROM identities identity
           WHERE identity.organization_id = o.id
             AND identity.started_at IS NOT NULL
             AND identity.ended_at IS NULL
             AND identity.blocked_at IS NULL) AS active_identity_count,
         primary_contact.user_id AS primary_contact_user_id,
         primary_contact.first_name AS primary_contact_first_name,
         primary_contact.last_name AS primary_contact_last_name,
         primary_contact.email AS primary_contact_email`;

const ORG_SUMMARY_FROM = `FROM organizations o
  LEFT JOIN members m ON m.organization_id = o.id
  LEFT JOIN member_category_assignments mca ON mca.member_id = m.id
  LEFT JOIN ${primaryContactProjection()}
    ON primary_contact.member_id = m.id`;

function toOrgSummary(row: OrgSummaryRow) {
  const primaryContactName = [row.primary_contact_first_name, row.primary_contact_last_name].filter(Boolean).join(" ");
  return {
    id: row.id,
    name: row.name,
    /* The public address of the member page, so staff can see it and see
       when a record has none — an organization created before the slug was
       minted at creation still answers on its id, and nothing in the portal
       said so (#15). */
    publicProfileHref: memberProfileHref({ id: row.id, slug: row.slug }),
    ...toOrganizationSummaryContent(row),
    membershipCategory: row.membership_category,
    // Falls back to the row's own creation time for organizations created
    // before consolidated migration 0035 added this column (or via a path that never set
    // it) — matches the same fallback members-directory.ts/member-self-service.ts use.
    memberSince: row.member_since ?? row.created_at,
    activeIdentityCount: row.active_identity_count,
    primaryContactName: primaryContactName || null,
    primaryContactEmail: row.primary_contact_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Current domain connections, without inferring a corporate hierarchy. Trusted SQL expressions only. */
function organizationConnectionDomainsSql(organizationIdSql: string) {
  return `SELECT domain FROM organization_domain_claims WHERE organization_id=${organizationIdSql} AND application_id IS NULL
    UNION SELECT identity.verified_email_domain FROM identities identity JOIN users person ON person.id=identity.user_id
      WHERE identity.organization_id=${organizationIdSql} AND person.active=1
        AND identity.verified_email_domain IS NOT NULL AND identity.source='verified_email'
        AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL`;
}

export function buildOrganizationsPageQuery(params: OrganizationsListQuery) {
  const search = params.q ? buildD1TextSearchFilter(params.q, ["o.name"]) : null;
  // A merged organization lives on only as the record of its merge; the directory lists the one it joined.
  const conditions = ["o.merged_into_organization_id IS NULL", ...(search ? [search.sql] : [])];
  const whereArgs: unknown[] = [...(search?.bindings ?? [])];
  if (params.relatedToOrganizationId) {
    conditions.push(`o.id<>? AND EXISTS (
      WITH source_domains(domain) AS (${organizationConnectionDomainsSql("?")}),
      related_domains(domain) AS (${organizationConnectionDomainsSql("o.id")})
      SELECT 1 FROM source_domains source JOIN related_domains related
        ON ${hostWithinDomainSql("source.domain", "related.domain")} OR ${hostWithinDomainSql("related.domain", "source.domain")}
    )`);
    whereArgs.push(params.relatedToOrganizationId, params.relatedToOrganizationId, params.relatedToOrganizationId);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(
    params.sort,
    {
      name: "o.name",
      membership_category: "membership_category",
      created_at: "o.created_at",
      identity_count: "active_identity_count",
    } satisfies Record<(typeof ORGANIZATIONS_SORT_COLUMNS)[number], string>,
    "o.name ASC",
    "o.id ASC",
  );
  const now = nowIso();

  return {
    source: {
      selectSql: ORG_SUMMARY_SELECT,
      fromSql: `${ORG_SUMMARY_FROM} ${where}`,
      countFromSql: `FROM organizations o ${where}`,
      bindings: [now, ...whereArgs],
      countBindings: whereArgs,
    },
    orderBy,
    limit: params.limit,
    offset: params.offset,
  };
}

export function prepareOrganizationsList(db: DatabaseLike, params: OrganizationsListQuery) {
  const statements = buildOffsetPageStatements(db, buildOrganizationsPageQuery(params));
  return {
    statements,
    decode(loaded: import("../../types").D1StatementResult[]) {
      const { rows, total } = decodeOffsetPageResults<OrgSummaryRow>(loaded[0]!, loaded[1]!);
      return { organizations: rows.map(toOrgSummary), total };
    },
  };
}
export async function listOrganizations(
  db: DatabaseLike,
  params: OrganizationsListQuery,
): Promise<{ organizations: ReturnType<typeof toOrgSummary>[]; total: number }> {
  const read = prepareOrganizationsList(db, params);
  return read.decode(await db.batch(read.statements));
}

// ── Detail ───────────────────────────────────────────────────────────────

export interface OrgDetailRow extends OrgSummaryRow {
  content_markdown: string | null;
  blog_url: string | null;
  blog_feed_url: string | null;
  press_url: string | null;
  press_feed_url: string | null;
  careers_url: string | null;
  links_json: string | null;
  merged_at: string | null;
  merged_into_id: string | null;
  merged_into_name: string | null;
}

interface IdentityRow {
  identity_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  email_id: string | null;
  headshot_r2_key: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  show_on_org_profile: number;
  created_at: string;
}

export async function fetchOrgDetailRow(db: DatabaseLike, id: string): Promise<OrgDetailRow | null> {
  return first<OrgDetailRow>(
    db,
    `SELECT o.id, o.name, o.slug, o.website, o.description, o.slogan, o.logo_r2_key, m.member_since,
            o.created_at, o.updated_at,
            mca.category_code AS membership_category,
            o.content_markdown, o.blog_url, o.blog_feed_url, o.press_url, o.press_feed_url, o.careers_url,
            o.links_json, o.merged_at,
            merged_into.id AS merged_into_id, merged_into.name AS merged_into_name,
            (SELECT COUNT(*) FROM identities identity
              WHERE identity.organization_id = o.id
                AND identity.started_at IS NOT NULL
                AND identity.ended_at IS NULL
                AND identity.blocked_at IS NULL) AS active_identity_count,
            primary_contact.user_id AS primary_contact_user_id,
            primary_contact.first_name AS primary_contact_first_name,
            primary_contact.last_name AS primary_contact_last_name,
            primary_contact.email AS primary_contact_email
     FROM organizations o
     LEFT JOIN members m ON m.organization_id = o.id
     LEFT JOIN member_category_assignments mca ON mca.member_id = m.id
     LEFT JOIN ${primaryContactProjection()}
       ON primary_contact.member_id = m.id
     LEFT JOIN organizations merged_into ON merged_into.id = o.merged_into_organization_id
     WHERE o.id = ?`,
    [nowIso(), id],
  );
}

async function fetchIdentities(db: DatabaseLike, organizationId: string): Promise<IdentityRow[]> {
  return all<IdentityRow>(
    db,
    `SELECT identity.id AS identity_id, identity.user_id, u.first_name, u.last_name,
            COALESCE(selected_email.email, u.email) AS email, identity.email_id,
            u.headshot_r2_key, identity.job_title, identity.biography, identity.links_json,
            identity.show_on_organization_profile AS show_on_org_profile, identity.created_at
     FROM identities identity
     JOIN users u ON u.id = identity.user_id
     LEFT JOIN user_emails selected_email
       ON selected_email.id = identity.email_id
      AND selected_email.user_id = identity.user_id
      AND selected_email.verified_at IS NOT NULL
     WHERE identity.organization_id = ?
       AND identity.started_at IS NOT NULL
       AND identity.ended_at IS NULL
       AND identity.blocked_at IS NULL
     ORDER BY identity.created_at ASC`,
    [organizationId],
  );
}

/** At most this many domains are named; an organization with more still counts its people. */
const EMAIL_DOMAIN_LIMIT = 10;

/**
 * The email domains the organization's active identities follow, with how
 * many people each one shows the organization to: a rename changes what all
 * of them see.
 */
async function fetchEmailDomains(db: DatabaseLike, organizationId: string) {
  return all<{ domain: string; people: number }>(
    db,
    `SELECT linked.domain, COUNT(DISTINCT linked.user_id) AS people
       FROM (SELECT identity.user_id, ${identityOrganizationEmailDomainSql("identity.id")} AS domain
               FROM identities identity
              WHERE identity.organization_id = ?
                AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL) linked
      WHERE linked.domain IS NOT NULL
      GROUP BY linked.domain
      ORDER BY people DESC, linked.domain
      LIMIT ${EMAIL_DOMAIN_LIMIT}`,
    [organizationId],
  );
}

/** The domains the organization owns through an approved claim. */
async function fetchClaimedDomains(db: DatabaseLike, organizationId: string): Promise<string[]> {
  const rows = await all<{ domain: string }>(
    db,
    `SELECT domain FROM organization_domain_claims
      WHERE organization_id = ? AND application_id IS NULL ORDER BY domain LIMIT ${EMAIL_DOMAIN_LIMIT}`,
    [organizationId],
  );
  return rows.map((row) => row.domain);
}

async function toOrgDetail(
  db: DatabaseLike,
  row: OrgDetailRow,
  identities: IdentityRow[],
  memberId: string | null,
  emailDomains: Array<{ domain: string; people: number }>,
  claimedDomains: string[],
) {
  const holders = memberId
    ? await resolveRepresentativeRoleHolders(db, memberId)
    : { primaryContactUserId: null, secondaryContactUserId: null };
  const primaryContactUserId = row.primary_contact_user_id;
  return {
    ...toOrgSummary(row),
    ...toOrganizationExtendedContent(row),
    primaryContactUserId,
    secondaryContactUserId: holders.secondaryContactUserId,
    emailDomains: emailDomains.map((entry) => ({ domain: entry.domain, people: Number(entry.people) })),
    claimedDomains,
    mergedInto:
      row.merged_into_id && row.merged_into_name && row.merged_at
        ? { id: row.merged_into_id, name: row.merged_into_name, mergedAt: row.merged_at }
        : null,
    identities: identities.map((r) => ({
      // identityId is identities.id for this exact acting capacity, never the
      // shared members.id aggregate exposed separately as membershipId.
      identityId: r.identity_id,
      membershipId: memberId,
      userId: r.user_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email,
      emailId: r.email_id,
      email: r.email,
      headshotUrl: publicUserHeadshotPath(r.user_id, r.headshot_r2_key),
      jobTitle: r.job_title,
      biography: r.biography,
      links: parseLinksJson(r.links_json),
      state: "active",
      showOnOrgProfile: r.show_on_org_profile === 1,
      isPrimaryContact: r.user_id === primaryContactUserId,
      isSecondaryContact: r.user_id === holders.secondaryContactUserId,
      createdAt: r.created_at,
    })),
  };
}

export async function getOrganization(db: DatabaseLike, id: string) {
  const row = await fetchOrgDetailRow(db, id);
  if (!row) throw new AppError(404, "NOT_FOUND", "Organization not found");
  const [identities, aggregate, emailDomains, claimedDomains] = await Promise.all([
    fetchIdentities(db, id),
    getOrgAggregate(db, id),
    fetchEmailDomains(db, id),
    fetchClaimedDomains(db, id),
  ]);
  return toOrgDetail(db, row, identities, aggregate?.id ?? null, emailDomains, claimedDomains);
}
