/**
 * Membership capacity use cases. Creates an organization (or org-less individual) plus
 * acting identity directly, and lists every organization or individual identity
 * for the staff UI (unfiltered by status, unlike the public directory in
 * members-directory.ts which only surfaces active members).
 */
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { buildProvisionOrganizationMembership } from "./membership/provisioning";
import { prepareAuditLog } from "./audit";
import { adminDatabaseUserId } from "../auth/admin-identity";
import type { DatabaseLike, UserBackedAuthAdmin } from "../types";
import type { MemberCapacityListQuery } from "../../../assets/shared/schemas/membership-management";
import { authorizedMembershipMutationDb } from "./membership-authorization";

export interface MemberProvisionIdentity {
  name: string;
  email: string;
  role?: string;
  links?: string[];
}

export interface MemberProvisionInput {
  organizationName?: string;
  website?: string;
  description?: string;
  membershipCategory: string;
  memberSince: string;
  identities: MemberProvisionIdentity[];
  workingGroupSlugs: string[];
  activationReason: string;
}

export interface MemberCapacitySummary {
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
 * Creates (or reuses) one membership aggregate plus N identity rows
 * (org-tied) or one individual aggregate (org-less), via the canonical
 * `provisionOrganizationMembership` use case (Phase 1 §1.5) shared with
 * application-approval provisioning (member-provisioning.ts). Idempotent on
 * the organization (an existing org with the same normalized name is
 * reused, matching the migration script's upsert convention).
 */
export async function provisionMember(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  input: MemberProvisionInput,
): Promise<{ organizationId: string | null; members: MemberCapacitySummary[] }> {
  const authorizedDb = authorizedMembershipMutationDb(db, actor, ["membership:write", "identities:activate"]);
  const { statements, buildResult } = await buildProvisionOrganizationMembership(authorizedDb, {
    organizationName: input.organizationName ?? null,
    website: input.website,
    description: input.description,
    membershipCategory: input.membershipCategory,
    memberSince: input.memberSince,
    identities: input.identities.map((identity) => ({
      name: identity.name,
      email: identity.email,
      jobTitle: identity.role,
      links: identity.links,
    })),
    identitySource: "staff",
    activateIdentities: true,
    workingGroupSlugs: input.workingGroupSlugs,
    grantedByUserId: adminDatabaseUserId(actor),
  });
  const result = buildResult();
  statements.push(
    prepareAuditLog(authorizedDb, "admin", actor.id, "member_created", "organization", result.organizationId, {
      membershipCategory: input.membershipCategory,
      organizationName: input.organizationName ?? null,
      identityEmails: input.identities.map((identity) => identity.email),
      activationReason: input.activationReason,
    }),
  );
  await authorizedDb.batch(statements);

  const members: MemberCapacitySummary[] = result.identities.map((identity) => ({
    id: identity.identityId,
    userId: identity.userId,
    organizationId: identity.organizationId,
    organizationName: identity.organizationId ? (input.organizationName ?? null) : null,
    name: identity.name,
    email: identity.email,
    membershipCategory: input.membershipCategory,
    status: "active",
    showOnOrgProfile: true,
    createdAt: identity.createdAt,
  }));

  return { organizationId: result.organizationId, members };
}

interface MemberCapacityRow {
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

// One row per identity, with its Member aggregate derived through the
// canonical capacity view. LIMIT/OFFSET apply once to the combined set.
const MEMBER_CAPACITY_SELECT = `
  SELECT identity.id, identity.user_id, identity.organization_id, o.name AS org_name,
         u.first_name, u.last_name, COALESCE(selected_email.email, u.email) AS email,
         mca.category_code, m.status,
         identity.show_on_organization_profile AS show_on_org_profile, identity.created_at
  FROM identities identity
  JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
  JOIN members m ON m.id = capacity.member_id
  LEFT JOIN organizations o ON o.id = identity.organization_id
  JOIN users u ON u.id = identity.user_id
  LEFT JOIN user_emails selected_email
    ON selected_email.id = identity.email_id
   AND selected_email.user_id = identity.user_id
   AND selected_email.verified_at IS NOT NULL
  JOIN member_category_assignments mca ON mca.member_id = m.id
  WHERE identity.started_at IS NOT NULL
    AND identity.ended_at IS NULL
    AND identity.blocked_at IS NULL
`;

function toMemberCapacitySummary(row: MemberCapacityRow): MemberCapacitySummary {
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
 * Unfiltered-by-status staff listing — one row per individual member or
 * per active organization identity, unlike the public directory
 * (members-directory.ts) which collapses each organization to a single
 * "primary contact" row and only shows status='active' members.
 */
export async function listMemberCapacities(
  db: DatabaseLike,
  params: MemberCapacityListQuery,
): Promise<{ members: MemberCapacitySummary[]; total: number }> {
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
  const { rows, total } = await queryPage<MemberCapacityRow>(db, {
    sql: `SELECT id, user_id, organization_id, org_name, first_name, last_name,
                   email, category_code, status, show_on_org_profile, created_at
            FROM (${MEMBER_CAPACITY_SELECT}) combined
            ${where}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });

  return { members: rows.map(toMemberCapacitySummary), total };
}
