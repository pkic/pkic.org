/**
 * Admin Organizations read model — list/detail projections over the
 * post-approval organization profile (data-bearing columns, pulled forward
 * by migration 0040) plus its representative roster
 * (`organization_representatives`, migration 0037). Split from the combined
 * admin-organizations.ts (PR #1 review, Phase 8) — see profile.ts for the
 * profile-update use case and representatives.ts for representative/member
 * provisioning; this file owns only reads.
 */
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import { resolveOrderBy } from "../../db/sort";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { REPRESENTATIVE_ROLE_IDS, resolveRepresentativeRoleHolders } from "../membership/representative-roles";
import type { DatabaseLike } from "../../types";

export function logoUrlFor(id: string, logoR2Key: string | null): string | null {
  return logoR2Key ? `/api/v1/members/${id}/logo` : null;
}

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
  LEFT JOIN users pu ON pu.id = pr.user_id
`;

function toOrgSummary(row: OrgSummaryRow) {
  const primaryContactName = [row.primary_contact_first_name, row.primary_contact_last_name].filter(Boolean).join(" ");
  return {
    id: row.id,
    name: row.name,
    website: row.website,
    description: row.description,
    slogan: row.slogan,
    logoUrl: logoUrlFor(row.id, row.logo_r2_key),
    membershipCategory: row.membership_category,
    // Falls back to the row's own creation time for organizations created
    // before migration 0049 added this column (or via a path that never set
    // it) — matches the same fallback members-directory.ts/member-self-service.ts use.
    memberSince: row.member_since ?? row.created_at,
    memberCount: row.member_count,
    primaryContactName: primaryContactName || null,
    primaryContactEmail: row.primary_contact_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Unqualified column/alias names, matching what ORG_SUMMARY_SELECT's result
// set actually labels them as (SQLite allows ORDER BY on a SELECT-list
// alias) — unambiguous here since none of these names collide with a
// joined `users` column.
const ORG_SORT_COLUMNS = ["name", "membership_category", "created_at", "member_count"] as const;

export async function listAdminOrganizations(
  db: DatabaseLike,
  params: { limit: number; offset: number; q?: string; sort?: string },
): Promise<{ organizations: ReturnType<typeof toOrgSummary>[]; total: number }> {
  const where = params.q ? "WHERE o.name LIKE ?" : "";
  const whereArgs = params.q ? [`%${params.q}%`] : [];
  const orderBy = resolveOrderBy(params.sort, ORG_SORT_COLUMNS, "ORDER BY o.name ASC");

  const [rows, totalRow] = await Promise.all([
    all<OrgSummaryRow>(db, `${ORG_SUMMARY_SELECT} ${where} ${orderBy} LIMIT ? OFFSET ?`, [
      ...whereArgs,
      params.limit,
      params.offset,
    ]),
    first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM organizations o ${where}`, whereArgs),
  ]);

  return { organizations: rows.map(toOrgSummary), total: totalRow?.total ?? 0 };
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
     LEFT JOIN users pu ON pu.id = pr.user_id
     WHERE o.id = ?`,
    [id],
  );
}

async function fetchRepresentatives(db: DatabaseLike, organizationId: string): Promise<RepresentativeRow[]> {
  return all<RepresentativeRow>(
    db,
    `SELECT r.id AS representative_id, r.member_id, r.user_id, u.first_name, u.last_name, u.email, u.job_title,
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
    contentMarkdown: row.content_markdown,
    blogUrl: row.blog_url,
    blogFeedUrl: row.blog_feed_url,
    pressUrl: row.press_url,
    pressFeedUrl: row.press_feed_url,
    careersUrl: row.careers_url,
    links: parseLinksJson(row.links_json),
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
