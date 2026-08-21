/**
 * Test fixtures for the post-Phase-1 membership schema (consolidated
 * migration 0035): membership_categories, member_category_assignments,
 * organization_representatives, and representative-role user_roles grants.
 * Builds on the real service-layer primitives
 * (functions/_lib/services/membership/*) rather than hand-rolled SQL, so
 * these fixtures exercise the same code paths production traffic does.
 */
import { nowIso } from "../../functions/_lib/utils/time";
import {
  getOrCreateOrganizationMemberAggregate,
  buildCreateIndividualMemberStatements,
} from "../../functions/_lib/services/membership/memberships";
import { buildAddRepresentativeStatement } from "../../functions/_lib/services/membership/representatives";
import {
  REPRESENTATIVE_ROLE_IDS,
  buildAssignRepresentativeRoleStatements,
  type RepresentativeRoleId,
} from "../../functions/_lib/services/membership/representative-roles";
import type { DatabaseLike } from "../../functions/_lib/types";

export { REPRESENTATIVE_ROLE_IDS };
export type { RepresentativeRoleId };

let userCounter = 0;

export async function insertUser(db: DatabaseLike, email?: string): Promise<string> {
  userCounter += 1;
  const id = crypto.randomUUID();
  const normalized = email ?? `member-fixture-${userCounter}@example.test`;
  await db
    .prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
    )
    .bind(id, normalized, normalized)
    .run();
  return id;
}

export async function insertOrganization(db: DatabaseLike, name?: string): Promise<string> {
  const id = crypto.randomUUID();
  const label = name ?? `Org ${id.slice(0, 8)}`;
  await db
    .prepare(
      `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
    )
    .bind(id, label, label.toLowerCase())
    .run();
  return id;
}

/** Creates (or reuses) an organization's membership aggregate with the given category. */
export async function seedOrganizationAggregate(
  db: DatabaseLike,
  organizationId: string,
  category = "A",
): Promise<string> {
  const aggregate = await getOrCreateOrganizationMemberAggregate(db, organizationId, category, nowIso());
  return aggregate.id;
}

/** Adds an active representative row for `userId` against an existing aggregate `memberId`. */
export async function addRepresentative(
  db: DatabaseLike,
  memberId: string,
  userId: string,
  opts: { showOnOrgProfile?: boolean } = {},
): Promise<string> {
  const { representativeId, statement } = buildAddRepresentativeStatement(db, {
    memberId,
    userId,
    showOnOrgProfile: opts.showOnOrgProfile,
  });
  await db.batch([statement]);
  return representativeId;
}

/**
 * One-call convenience: creates a user, an organization aggregate (or
 * reuses `organizationId` if given), and an active representative row
 * linking them. Returns everything callers typically need.
 */
export async function insertOrgRepresentative(
  db: DatabaseLike,
  opts: { organizationId?: string; category?: string; email?: string } = {},
): Promise<{ userId: string; organizationId: string; memberId: string; representativeId: string }> {
  const userId = await insertUser(db, opts.email);
  const organizationId = opts.organizationId ?? (await insertOrganization(db));
  const memberId = await seedOrganizationAggregate(db, organizationId, opts.category ?? "A");
  const representativeId = await addRepresentative(db, memberId, userId);
  return { userId, organizationId, memberId, representativeId };
}

/** Creates a user plus an org-less individual membership aggregate (H5/H6/H7). */
export async function insertIndividualMember(
  db: DatabaseLike,
  category = "H6",
  email?: string,
): Promise<{ userId: string; memberId: string }> {
  const userId = await insertUser(db, email);
  const { memberId, statements } = buildCreateIndividualMemberStatements(db, userId, category, nowIso());
  await db.batch(statements);
  return { userId, memberId };
}

/** Grants a representative role (primary/secondary contact or voting delegate), revoking any prior holder. */
export async function assignRepresentativeRole(
  db: DatabaseLike,
  memberId: string,
  userId: string,
  roleId: RepresentativeRoleId,
): Promise<void> {
  const statements = await buildAssignRepresentativeRoleStatements(db, { memberId, userId, roleId });
  await db.batch(statements);
}
