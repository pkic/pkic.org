/**
 * Admin Organizations read model — list/detail projections over the
 * post-approval organization profile (data-bearing columns, pulled forward
 * by consolidated migration 0035) plus its representative roster
 * (`organization_representatives`, consolidated migration 0035). Split from the combined
 * admin-organizations.ts (PR #1 review, Phase 8) — see profile.ts for the
 * profile-update use case and representatives.ts for representative/member
 * provisioning; this file owns only reads.
 */
import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { AppError } from "../../errors";
import { resolveOrderBy } from "../../db/sort";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { ADMIN_ORGANIZATIONS_SORT_COLUMNS } from "../../../../assets/shared/schemas/admin-organizations";
import { REPRESENTATIVE_ROLE_IDS, resolveRepresentativeRoleHolders } from "../membership/representative-roles";
import { toOrganizationExtendedContent, toOrganizationSummaryContent } from "../organization-content/fields";
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
  member_count: number;
  primary_contact_first_name: string | null;
  primary_contact_last_name: string | null;
  primary_contact_email: string | null;
}

const ORG_SUMMARY_SELECT = `
  SELECT o.id, o.name, o.website, o.description, o.slogan, o.logo_r2_key, m.member_since, o.created_at, o.updated_at,
         mca.category_code AS membership_category,
         (SELECT COUNT(*) FROM organization_representatives r
           JOIN members m2 ON m2.id = r.member_id WHERE m2.organization_id = o.id AND r.left_at IS NULL) AS member_count,
         pu.first_name AS primary_contact_first_name, pu.last_name AS primary_contact_last_name,
         pu.email AS primary_contact_email
  FROM organizations o
  LEFT JOIN members m ON m.organization_id = o.id
  LEFT JOIN member_category_assignments mca ON mca.member_id = m.id
  LEFT JOIN user_roles pr ON pr.context_type = 'organization' AND pr.context_id = m.id
    AND pr.role_id = '${REPRESENTATIVE_ROLE_IDS.primaryContact}' AND pr.revoked_at IS NULL
  LEFT JOIN organization_representatives pr_rep
    ON pr_rep.member_id = m.id AND pr_rep.user_id = pr.user_id AND pr_rep.left_at IS NULL
  LEFT JOIN users pu ON pu.id = pr.user_id
    AND pr_rep.id IS NOT NULL
`;

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
    memberCount: row.member_count,
    primaryContactName: primaryContactName || null,
    primaryContactEmail: row.primary_contact_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAdminOrganizations(
  db: DatabaseLike,
  params: { limit: number; offset: number; q?: string; sort?: string },
): Promise<{ organizations: ReturnType<typeof toOrgSummary>[]; total: number }> {
  const search = params.q ? buildD1TextSearchFilter(params.q, ["o.name"]) : null;
  const where = search ? `WHERE ${search.sql}` : "";
  const whereArgs = search?.bindings ?? [];
  const orderBy = resolveOrderBy(params.sort, ADMIN_ORGANIZATIONS_SORT_COLUMNS, "ORDER BY o.name ASC", "o.id ASC");

  const { rows, total } = await queryPage<OrgSummaryRow>(db, {
    sql: `${ORG_SUMMARY_SELECT} ${where}`,
    bindings: whereArgs,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });

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

interface RepresentativeRow {
  representative_id: string;
  member_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  job_title: string | null;
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
            (SELECT COUNT(*) FROM organization_representatives r
              JOIN members m2 ON m2.id = r.member_id WHERE m2.organization_id = o.id AND r.left_at IS NULL) AS member_count,
            pu.first_name AS primary_contact_first_name, pu.last_name AS primary_contact_last_name,
            pu.email AS primary_contact_email
     FROM organizations o
     LEFT JOIN members m ON m.organization_id = o.id
     LEFT JOIN member_category_assignments mca ON mca.member_id = m.id
     LEFT JOIN user_roles pr ON pr.context_type = 'organization' AND pr.context_id = m.id
       AND pr.role_id = '${REPRESENTATIVE_ROLE_IDS.primaryContact}' AND pr.revoked_at IS NULL
     LEFT JOIN organization_representatives pr_rep
       ON pr_rep.member_id = m.id AND pr_rep.user_id = pr.user_id AND pr_rep.left_at IS NULL
     LEFT JOIN users pu ON pu.id = pr.user_id
       AND pr_rep.id IS NOT NULL
     WHERE o.id = ?`,
    [id],
  );
}

async function fetchRepresentatives(db: DatabaseLike, organizationId: string): Promise<RepresentativeRow[]> {
  return all<RepresentativeRow>(
    db,
    `SELECT r.id AS representative_id, r.member_id, r.user_id, u.first_name, u.last_name, u.email, u.job_title,
            u.links_json,
            r.show_on_org_profile, r.created_at
     FROM organization_representatives r
     JOIN members m ON m.id = r.member_id
     JOIN users u ON u.id = r.user_id
     WHERE m.organization_id = ? AND r.left_at IS NULL
     ORDER BY r.created_at ASC`,
    [organizationId],
  );
}

async function toOrgDetail(
  db: DatabaseLike,
  row: OrgDetailRow,
  representatives: RepresentativeRow[],
  memberId: string | null,
) {
  const holders = memberId
    ? await resolveRepresentativeRoleHolders(db, memberId)
    : { primaryContactUserId: null, secondaryContactUserId: null, votingDelegateUserId: null };
  return {
    ...toOrgSummary(row),
    ...toOrganizationExtendedContent(row),
    primaryContactUserId: holders.primaryContactUserId,
    secondaryContactUserId: holders.secondaryContactUserId,
    votingDelegateUserId: holders.votingDelegateUserId,
    representatives: representatives.map((r) => ({
      // representativeId is this representative's own
      // organization_representatives.id — the identifier PATCH/DELETE
      // /api/v1/admin/members/:id expects — never the shared aggregate
      // members.id (every representative of this organization shares one
      // aggregate row, exposed separately below as membershipId).
      representativeId: r.representative_id,
      membershipId: memberId,
      userId: r.user_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email,
      email: r.email,
      jobTitle: r.job_title,
      links: parseLinksJson(r.links_json),
      status: "active",
      showOnOrgProfile: r.show_on_org_profile === 1,
      isPrimaryContact: r.user_id === holders.primaryContactUserId,
      isSecondaryContact: r.user_id === holders.secondaryContactUserId,
      createdAt: r.created_at,
    })),
  };
}

export async function getAdminOrganization(db: DatabaseLike, id: string) {
  const row = await fetchOrgDetailRow(db, id);
  if (!row) throw new AppError(404, "NOT_FOUND", "Organization not found");
  const [representatives, aggregate] = await Promise.all([fetchRepresentatives(db, id), getOrgAggregate(db, id)]);
  return toOrgDetail(db, row, representatives, aggregate?.id ?? null);
}
