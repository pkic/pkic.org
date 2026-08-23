/**
 * Interim Admin Tool (Interim Admin Tool — Manual Member
 * Management). Creates an organization (or org-less individual) plus
 * representative(s) directly, and lists every representative/individual
 * for the admin UI (unfiltered by status, unlike the public directory in
 * members-directory.ts which only surfaces active members).
 */
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { buildProvisionOrganizationMembership } from "./membership/provisioning";
import { prepareAuditLog } from "./audit";
import { adminDatabaseUserId } from "../auth/admin-identity";
import type { AuthAdmin, DatabaseLike } from "../types";
import type { AdminMembersListQuery } from "../../../assets/shared/schemas/admin-members";

export interface AdminMemberCreateRepresentative {
  name: string;
  email: string;
  role?: string;
  links?: string[];
}

export interface AdminMemberCreateInput {
  organizationName?: string;
  website?: string;
  description?: string;
  membershipCategory: string;
  memberSince: string;
  representatives: AdminMemberCreateRepresentative[];
  workingGroupSlugs: string[];
}

export interface AdminMemberSummary {
  id: string;
  userId: string;
  organizationId: string | null;
  organizationName: string | null;
  name: string;
  email: string;
  membershipCategory: string;
  status: string;
  showOnOrgProfile: boolean;
  createdAt: string;
}

/**
 * Creates (or reuses) one membership aggregate plus N representative rows
 * (org-tied) or one individual aggregate (org-less), via the canonical
 * `provisionOrganizationMembership` use case (Phase 1 §1.5) shared with
 * application-approval provisioning (member-provisioning.ts). Idempotent on
 * the organization (an existing org with the same normalized name is
 * reused, matching the migration script's upsert convention).
 */
export async function createAdminMember(
  db: DatabaseLike,
  actor: AuthAdmin,
  input: AdminMemberCreateInput,
): Promise<{ organizationId: string | null; members: AdminMemberSummary[] }> {
  const { statements, buildResult } = await buildProvisionOrganizationMembership(db, {
    organizationName: input.organizationName ?? null,
    website: input.website,
    description: input.description,
    membershipCategory: input.membershipCategory,
    memberSince: input.memberSince,
    representatives: input.representatives.map((rep) => ({
      name: rep.name,
      email: rep.email,
      jobTitle: rep.role,
      links: rep.links,
    })),
    workingGroupSlugs: input.workingGroupSlugs,
    grantedByUserId: adminDatabaseUserId(actor),
  });
  const result = buildResult();
  statements.push(
    prepareAuditLog(db, "admin", actor.id, "member_created", "organization", result.organizationId, {
      membershipCategory: input.membershipCategory,
      organizationName: input.organizationName ?? null,
      representativeEmails: input.representatives.map((representative) => representative.email),
    }),
  );
  await db.batch(statements);

  const members: AdminMemberSummary[] = result.representatives.map((rep) => ({
    id: rep.representativeId ?? rep.membershipId,
    userId: rep.userId,
    organizationId: rep.organizationId,
    organizationName: rep.organizationId ? (input.organizationName ?? null) : null,
    name: rep.name,
    email: rep.email,
    membershipCategory: input.membershipCategory,
    status: "active",
    showOnOrgProfile: true,
    createdAt: rep.createdAt,
  }));

  return { organizationId: result.organizationId, members };
}

interface AdminMemberRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  org_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  category_code: string;
  status: string;
  show_on_org_profile: number;
  created_at: string;
}

// One row per individual member (organization_id IS NULL) unioned with one
// row per active organization representative — a single bounded, sorted
// query so LIMIT/OFFSET apply to the combined set once, not to each half
// independently (which would produce wrong pages beyond page 1).
const ADMIN_MEMBERS_SELECT = `
  SELECT m.id AS id, m.user_id, NULL AS organization_id, NULL AS org_name,
         u.first_name, u.last_name, u.email, mca.category_code, m.status,
         1 AS show_on_org_profile, m.created_at
  FROM members m
  JOIN users u ON u.id = m.user_id
  JOIN member_category_assignments mca ON mca.member_id = m.id
  WHERE m.organization_id IS NULL

  UNION ALL

  SELECT r.id AS id, r.user_id, m.organization_id, o.name AS org_name,
         u.first_name, u.last_name, u.email, mca.category_code, m.status,
         r.show_on_org_profile, r.created_at
  FROM organization_representatives r
  JOIN members m ON m.id = r.member_id
  JOIN organizations o ON o.id = m.organization_id
  JOIN users u ON u.id = r.user_id
  JOIN member_category_assignments mca ON mca.member_id = m.id
  WHERE r.left_at IS NULL
`;

function toAdminMemberSummary(row: AdminMemberRow): AdminMemberSummary {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    organizationName: row.org_name,
    name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    email: row.email,
    membershipCategory: row.category_code,
    status: row.status,
    showOnOrgProfile: row.show_on_org_profile === 1,
    createdAt: row.created_at,
  };
}

/**
 * Unfiltered-by-status admin listing — one row per individual member or
 * per active organization representative, unlike the public directory
 * (members-directory.ts) which collapses each organization to a single
 * "primary contact" row and only shows status='active' members.
 */
export async function listAdminMembers(
  db: DatabaseLike,
  params: AdminMembersListQuery,
): Promise<{ members: AdminMemberSummary[]; total: number }> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (params.membershipCategory) {
    conditions.push("category_code = ?");
    bindings.push(params.membershipCategory);
  }
  if (params.status) {
    conditions.push("status = ?");
    bindings.push(params.status);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, [
      "first_name",
      "last_name",
      "email",
      "org_name",
      "category_code",
      "status",
    ]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveMappedOrderBy(
    params.sort,
    {
      name: "LOWER(COALESCE(NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email))",
      email: "email COLLATE NOCASE",
      organizationName: "org_name COLLATE NOCASE",
      membershipCategory: "category_code",
      status: "status",
      createdAt: "created_at",
    },
    "created_at DESC",
    "id ASC",
  );
  const { rows, total } = await queryPage<AdminMemberRow>(db, {
    sql: `SELECT id, user_id, organization_id, org_name, first_name, last_name,
                   email, category_code, status, show_on_org_profile, created_at
            FROM (${ADMIN_MEMBERS_SELECT}) combined
            ${where}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });

  return { members: rows.map(toAdminMemberSummary), total };
}
