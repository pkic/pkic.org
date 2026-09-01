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
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { AppError } from "../../errors";
import { resolveMappedOrderBy } from "../../db/sort";
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
}

const ORG_SUMMARY_SELECT = `
  SELECT o.id, o.name, o.website, o.description, o.slogan, o.logo_r2_key, m.member_since, o.created_at, o.updated_at,
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

export function buildOrganizationsPageQuery(params: OrganizationsListQuery) {
  const search = params.q ? buildD1TextSearchFilter(params.q, ["o.name"]) : null;
  const where = search ? `WHERE ${search.sql}` : "";
  const whereArgs = search?.bindings ?? [];
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

export async function listOrganizations(
  db: DatabaseLike,
  params: OrganizationsListQuery,
): Promise<{ organizations: ReturnType<typeof toOrgSummary>[]; total: number }> {
  const pageQuery = buildOrganizationsPageQuery(params);
  const { rows, total } = await queryPage<OrgSummaryRow>(db, pageQuery);

  return { organizations: rows.map(toOrgSummary), total };
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
}

interface IdentityRow {
  identity_id: string;
  member_id: string;
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
    `SELECT o.id, o.name, o.website, o.description, o.slogan, o.logo_r2_key, m.member_since, o.created_at, o.updated_at,
            mca.category_code AS membership_category,
            o.content_markdown, o.blog_url, o.blog_feed_url, o.press_url, o.press_feed_url, o.careers_url,
            o.links_json,
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
     WHERE o.id = ?`,
    [nowIso(), id],
  );
}

async function fetchIdentities(db: DatabaseLike, organizationId: string): Promise<IdentityRow[]> {
  return all<IdentityRow>(
    db,
    `SELECT identity.id AS identity_id, capacity.member_id, identity.user_id, u.first_name, u.last_name,
            COALESCE(selected_email.email, u.email) AS email, identity.email_id,
            u.headshot_r2_key, identity.job_title, identity.biography, identity.links_json,
            identity.show_on_organization_profile AS show_on_org_profile, identity.created_at
     FROM identities identity
     JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
     JOIN users u ON u.id = identity.user_id
     LEFT JOIN user_emails selected_email ON selected_email.id = identity.email_id
     WHERE identity.organization_id = ?
       AND identity.started_at IS NOT NULL
       AND identity.ended_at IS NULL
       AND identity.blocked_at IS NULL
     ORDER BY identity.created_at ASC`,
    [organizationId],
  );
}

async function toOrgDetail(db: DatabaseLike, row: OrgDetailRow, identities: IdentityRow[], memberId: string | null) {
  const holders = memberId
    ? await resolveRepresentativeRoleHolders(db, memberId)
    : { primaryContactUserId: null, secondaryContactUserId: null };
  const primaryContactUserId = row.primary_contact_user_id;
  return {
    ...toOrgSummary(row),
    ...toOrganizationExtendedContent(row),
    primaryContactUserId,
    secondaryContactUserId: holders.secondaryContactUserId,
    identities: identities.map((r) => ({
      // identityId is identities.id for this exact acting capacity, never the
      // shared members.id aggregate exposed separately as membershipId.
      identityId: r.identity_id,
      membershipId: memberId,
      userId: r.user_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email,
      emailId: r.email_id,
      email: r.email,
      headshotUrl: publicUserHeadshotPath(r.headshot_r2_key),
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
  const [identities, aggregate] = await Promise.all([fetchIdentities(db, id), getOrgAggregate(db, id)]);
  return toOrgDetail(db, row, identities, aggregate?.id ?? null);
}
