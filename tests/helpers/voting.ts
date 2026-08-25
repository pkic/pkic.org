import { env } from "cloudflare:workers";
import type { AuthAdmin, AuthMember, DatabaseLike } from "../../functions/_lib/types";
import { createVoteDirect, type CreateVoteInput } from "../../functions/_lib/services/votes";
import { joinGroup } from "../../functions/_lib/services/groups";
import { requireMemberFromRequest } from "../../functions/_lib/auth/member";
import { createAdminSession, createMemberSession } from "./auth";
import { queryAll, seedEventAndAdmin } from "./context";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./membership";

export const TEST_GROUPS = {
  allMembers: "20000000-0000-4000-8000-000000000001",
  pqc: "20000000-0000-4000-8000-000000000003",
  cm: "20000000-0000-4000-8000-000000000004",
} as const;

export interface OrganizationCapacity {
  userId: string;
  organizationId: string;
  memberId: string;
}

export async function createOrganizationCapacity(
  db: DatabaseLike,
  options: { userId?: string; category?: string; organizationName?: string; email?: string } = {},
): Promise<OrganizationCapacity> {
  const userId = options.userId ?? (await insertUser(db, options.email));
  const organizationId = await insertOrganization(db, options.organizationName);
  const memberId = await seedOrganizationAggregate(db, organizationId, options.category ?? "A");
  await addRepresentative(db, memberId, userId);
  return { userId, organizationId, memberId };
}

export async function joinVotingGroup(
  db: DatabaseLike,
  groupId: string,
  userId: string,
  memberIds: string[],
): Promise<void> {
  await joinGroup(db, groupId, {
    actorUserId: userId,
    targetUserId: userId,
    selection: { mode: "selected", memberIds },
    source: "self_service",
    allowManaged: false,
  });
}

export async function resolveAuthMember(
  db: DatabaseLike,
  userId: string,
  suffix = crypto.randomUUID(),
): Promise<AuthMember> {
  const token = await createMemberSession(db, userId, `vote-member-${suffix}`);
  return requireMemberFromRequest(
    db,
    new Request("https://app.test/api/v1/portal/votes", {
      headers: { authorization: `Bearer ${token}` },
    }),
    env as never,
  );
}

export async function seedVotingAdmin(
  db: DatabaseLike,
): Promise<{ admin: AuthAdmin; adminId: string; adminToken: string }> {
  await seedEventAndAdmin(db);
  const [row] = await queryAll<{ id: string; email: string }>(
    db,
    "SELECT id, email FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
  );
  const admin: AuthAdmin = { identityType: "user", id: row.id, email: row.email, role: "admin" };
  return {
    admin,
    adminId: row.id,
    adminToken: await createAdminSession(db, row.id, `vote-admin-${crypto.randomUUID()}`),
  };
}

export async function createCanonicalVote(
  db: DatabaseLike,
  admin: AuthAdmin,
  overrides: Partial<CreateVoteInput> = {},
) {
  return createVoteDirect(db, admin, {
    title: `Canonical vote ${crypto.randomUUID()}`,
    voteType: "motion",
    ownerGroupId: TEST_GROUPS.pqc,
    electorateMode: "per_member",
    thresholdType: "simple_majority",
    closesAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ...overrides,
  });
}

export async function createIndividualAndOrganizationUser(
  db: DatabaseLike,
): Promise<{ userId: string; individualMemberId: string; organizationMemberId: string }> {
  const individual = await insertIndividualMember(db, "H6");
  const organization = await createOrganizationCapacity(db, { userId: individual.userId, category: "A" });
  return {
    userId: individual.userId,
    individualMemberId: individual.memberId,
    organizationMemberId: organization.memberId,
  };
}

export function authorizedRequest(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(new URL(path, "https://app.test"), { ...init, headers });
}
