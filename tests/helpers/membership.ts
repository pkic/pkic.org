/**
 * Test fixtures for the post-Phase-1 membership schema (consolidated
 * migration 0035): membership_categories, member_category_assignments,
 * identities and identity-owned contact-role user_roles grants.
 * Builds on the real service-layer primitives
 * (functions/_lib/services/membership/*) rather than hand-rolled SQL, so
 * these fixtures exercise the same code paths production traffic does.
 */
import { nowIso } from "../../functions/_lib/utils/time";
import {
  getOrCreateOrganizationMemberAggregate,
  buildCreateIndividualMemberStatements,
} from "../../functions/_lib/services/membership/memberships";
import { buildCreateIdentityStatement } from "../../functions/_lib/services/membership/identities";
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

/** Adds an active organization identity for `userId` against an existing aggregate `memberId`. */
export async function addRepresentative(
  db: DatabaseLike,
  memberId: string,
  userId: string,
  opts: { jobTitle?: string | null; showOnOrgProfile?: boolean } = {},
): Promise<string> {
  const member = await db.prepare("SELECT organization_id FROM members WHERE id = ?").bind(memberId).first<{
    organization_id: string | null;
  }>();
  if (!member?.organization_id) throw new Error("Organization Member aggregate required");
  const { identityId, statement } = await buildCreateIdentityStatement(db, {
    userId,
    organizationId: member.organization_id,
    source: "staff",
    jobTitle: opts.jobTitle,
    showOnOrganizationProfile: opts.showOnOrgProfile,
    startImmediately: true,
  });
  await db.batch([statement]);
  return identityId;
}

/**
 * One-call convenience: creates a user, an organization aggregate (or
 * reuses `organizationId` if given), and an active representative row
 * linking them. Returns everything callers typically need.
 */
export async function insertOrgRepresentative(
  db: DatabaseLike,
  opts: { organizationId?: string; category?: string; email?: string } = {},
): Promise<{ userId: string; organizationId: string; memberId: string; identityId: string }> {
  const userId = await insertUser(db, opts.email);
  const organizationId = opts.organizationId ?? (await insertOrganization(db));
  const memberId = await seedOrganizationAggregate(db, organizationId, opts.category ?? "A");
  const identityId = await addRepresentative(db, memberId, userId);
  return { userId, organizationId, memberId, identityId };
}

/** Creates a user plus an org-less individual membership aggregate (H5/H6/H7). */
export async function insertIndividualMember(
  db: DatabaseLike,
  category = "H6",
  email?: string,
): Promise<{ userId: string; memberId: string; identityId: string }> {
  const userId = await insertUser(db, email);
  const { memberId, statements } = buildCreateIndividualMemberStatements(db, userId, category, nowIso());
  const { identityId, statement: identityStatement } = await buildCreateIdentityStatement(db, {
    userId,
    organizationId: null,
    source: "staff",
    startImmediately: true,
  });
  await db.batch([...statements, identityStatement]);
  return { userId, memberId, identityId };
}

/** Grants a primary or secondary organization-contact role, revoking any prior holder. */
export async function assignRepresentativeRole(
  db: DatabaseLike,
  memberId: string,
  userId: string,
  roleId: RepresentativeRoleId,
): Promise<void> {
  const statements = await buildAssignRepresentativeRoleStatements(db, { memberId, userId, roleId });
  await db.batch(statements);
}
