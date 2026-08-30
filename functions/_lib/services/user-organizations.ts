/**
 * Self-service organization feed — the set of organizations the current
 * user actively represents, independent of their currently selected acting
 * capacity (see functions/api/v1/organizations/authorization.ts). Powers
 * the avatar-menu organization switcher and dashboard.
 *
 * Set-based: one page+count query over the caller's active representative
 * rows joined to organizations, then one enrichment query for contact roles
 * and one for pending content reviews — never a per-organization loop.
 */
import { all } from "../db/queries";
import { queryPage, type OffsetPageQuery } from "../db/pagination";
import { buildD1JsonMembershipFilter } from "../db/json-membership";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { REPRESENTATIVE_ROLE_IDS, representativeRoleActivePredicate } from "./membership/representative-roles";
import { nowIso } from "../utils/time";
import type { DatabaseLike } from "../types";
import type { UserOrganization, UserOrganizationsListQuery } from "../../../assets/shared/schemas/user-organizations";

interface UserOrganizationRow {
  organization_id: string;
  member_id: string;
  name: string;
  membership_category: string | null;
}

const USER_ORGANIZATIONS_FROM = `
  FROM organization_representatives r
  JOIN members m ON m.id = r.member_id AND m.status = 'active' AND m.organization_id IS NOT NULL
  JOIN organizations o ON o.id = m.organization_id`;

/** Exported separately so an EXPLAIN QUERY PLAN test can assert index use (tests/admin-list-query-plans.test.ts). */
export function buildUserOrganizationsPageQuery(userId: string, params: UserOrganizationsListQuery): OffsetPageQuery {
  const search = params.q ? buildD1TextSearchFilter(params.q, ["o.name"]) : null;
  const conditions = ["r.user_id = ?", "r.left_at IS NULL", ...(search ? [search.sql] : [])];
  const bindings = [userId, ...(search?.bindings ?? [])];
  const where = `WHERE ${conditions.join(" AND ")}`;
  const orderBy = resolveMappedOrderBy(params.sort, { name: "o.name" }, "o.name ASC", "o.id ASC");

  return {
    source: {
      selectSql:
        "SELECT o.id AS organization_id, m.id AS member_id, o.name AS name, mca.category_code AS membership_category",
      fromSql: `${USER_ORGANIZATIONS_FROM}\n  LEFT JOIN member_category_assignments mca ON mca.member_id = m.id\n  ${where}`,
      countFromSql: `${USER_ORGANIZATIONS_FROM}\n  ${where}`,
      bindings,
      countBindings: bindings,
    },
    orderBy,
    limit: params.limit,
    offset: params.offset,
  };
}

interface ContactRoleRow {
  member_id: string;
  role_id: string;
}

async function resolveContactRoles(
  db: DatabaseLike,
  userId: string,
  memberIds: readonly string[],
): Promise<Map<string, { isOrgContact: boolean; isPrimaryContact: boolean }>> {
  const memberFilter = buildD1JsonMembershipFilter("ur.context_id", memberIds);
  const rows = await all<ContactRoleRow>(
    db,
    `SELECT ur.context_id AS member_id, ur.role_id
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     JOIN organization_representatives rep
       ON rep.member_id = ur.context_id AND rep.user_id = ur.user_id
     WHERE ur.context_type = 'organization'
       AND ur.user_id = ?
       AND ur.role_id IN (?, ?)
       AND ${memberFilter.sql}
       AND ${representativeRoleActivePredicate()}`,
    [
      userId,
      REPRESENTATIVE_ROLE_IDS.primaryContact,
      REPRESENTATIVE_ROLE_IDS.secondaryContact,
      ...memberFilter.bindings,
      nowIso(),
    ],
  );
  const byMemberId = new Map<string, { isOrgContact: boolean; isPrimaryContact: boolean }>();
  for (const row of rows) {
    const existing = byMemberId.get(row.member_id) ?? { isOrgContact: false, isPrimaryContact: false };
    existing.isOrgContact = true;
    if (row.role_id === REPRESENTATIVE_ROLE_IDS.primaryContact) existing.isPrimaryContact = true;
    byMemberId.set(row.member_id, existing);
  }
  return byMemberId;
}

async function resolvePendingReviewOrganizationIds(
  db: DatabaseLike,
  organizationIds: readonly string[],
): Promise<Set<string>> {
  const filter = buildD1JsonMembershipFilter("organization_id", organizationIds);
  const rows = await all<{ organization_id: string }>(
    db,
    `SELECT DISTINCT organization_id FROM organization_content_reviews WHERE status = 'pending' AND ${filter.sql}`,
    filter.bindings,
  );
  return new Set(rows.map((row) => row.organization_id));
}

export async function listUserOrganizations(
  db: DatabaseLike,
  userId: string,
  params: UserOrganizationsListQuery,
): Promise<{ organizations: UserOrganization[]; total: number }> {
  const { rows, total } = await queryPage<UserOrganizationRow>(db, buildUserOrganizationsPageQuery(userId, params));
  if (rows.length === 0) return { organizations: [], total };

  const memberIds = rows.map((row) => row.member_id);
  const organizationIds = rows.map((row) => row.organization_id);
  const [contactRoles, pendingReviewOrganizationIds] = await Promise.all([
    resolveContactRoles(db, userId, memberIds),
    resolvePendingReviewOrganizationIds(db, organizationIds),
  ]);

  return {
    total,
    organizations: rows.map((row) => {
      const contact = contactRoles.get(row.member_id) ?? { isOrgContact: false, isPrimaryContact: false };
      return {
        organizationId: row.organization_id,
        memberId: row.member_id,
        name: row.name,
        membershipCategory: row.membership_category,
        isOrgContact: contact.isOrgContact,
        isPrimaryContact: contact.isPrimaryContact,
        hasPendingReview: contact.isOrgContact && pendingReviewOrganizationIds.has(row.organization_id),
      };
    }),
  };
}
