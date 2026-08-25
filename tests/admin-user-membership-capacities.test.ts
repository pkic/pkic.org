import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { adminUserDetailSchema } from "../assets/shared/schemas/admin-users";
import { getAdminUserDetail } from "../functions/_lib/services/admin-user-detail";
import {
  addOrganizationRepresentative,
  grantIndividualMembership,
} from "../functions/_lib/services/admin-organizations/representatives";
import type { AuthAdmin } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";

async function joinGroup(groupId: string, userId: string, memberId: string): Promise<void> {
  const at = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO group_memberships
       (id, group_id, user_id, member_id, source, joined_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'staff', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), groupId, userId, memberId, at, at, at)
    .run();
}

describe("admin user membership capacities", () => {
  beforeEach(resetDb);

  it("returns every represented Member separately with only that capacity's groups", async () => {
    const userId = await insertUser(env.DB, "multiple-organizations@example.test");
    const organizationA = await insertOrganization(env.DB, "Capacity Organization A");
    const organizationB = await insertOrganization(env.DB, "Capacity Organization B");
    const memberA = await seedOrganizationAggregate(env.DB, organizationA, "A");
    const memberB = await seedOrganizationAggregate(env.DB, organizationB, "B");
    await addRepresentative(env.DB, memberA, userId);
    await addRepresentative(env.DB, memberB, userId);
    await joinGroup("20000000-0000-4000-8000-000000000003", userId, memberA);
    await joinGroup("20000000-0000-4000-8000-000000000004", userId, memberB);

    const detail = adminUserDetailSchema.parse(await getAdminUserDetail(env.DB, userId));

    expect(detail.memberships).toHaveLength(2);
    const byOrganization = new Map(detail.memberships.map((membership) => [membership.organizationName, membership]));
    expect(byOrganization.get("Capacity Organization A")?.groups.map((group) => group.slug)).toEqual(["pqc"]);
    expect(byOrganization.get("Capacity Organization B")?.groups.map((group) => group.slug)).toEqual(["cm"]);
  });

  it("rejects granting an individual membership to an active organization representative", async () => {
    const userId = await insertUser(env.DB, "representative-conflict@example.test");
    const organizationId = await insertOrganization(env.DB, "Representative Conflict Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);

    await expect(grantIndividualMembership(env.DB, userId, userId, "H6")).rejects.toMatchObject({
      status: 409,
      code: "ORGANIZATION_CAPACITY_CONFLICT",
    });
    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, user_id, status, created_at, updated_at)
         VALUES (?, 'individual', ?, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), userId)
        .run(),
    ).rejects.toThrow("individual and organization representative capacities are mutually exclusive");
  });

  it("rejects adding an organization representation to an active individual member", async () => {
    const actorUserId = await insertUser(env.DB, "capacity-admin@example.test");
    const actor: AuthAdmin = {
      identityType: "user",
      id: actorUserId,
      email: "capacity-admin@example.test",
      role: "admin",
    };
    const individual = await insertIndividualMember(env.DB, "H6", "individual-conflict@example.test");
    const organizationId = await insertOrganization(env.DB, "Individual Conflict Organization");
    await seedOrganizationAggregate(env.DB, organizationId, "A");

    await expect(
      addOrganizationRepresentative(env.DB, actor, organizationId, {
        name: "Individual Conflict",
        email: "individual-conflict@example.test",
      }),
    ).rejects.toMatchObject({ status: 409, code: "INDIVIDUAL_CAPACITY_CONFLICT" });
    const organizationMemberId = (
      await env.DB.prepare("SELECT id FROM members WHERE organization_id = ?")
        .bind(organizationId)
        .first<{ id: string }>()
    )?.id;
    await expect(
      env.DB.prepare(
        `INSERT INTO organization_representatives
           (id, member_id, user_id, source, joined_at, created_at, updated_at)
         VALUES (?, ?, ?, 'staff', datetime('now'), datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), organizationMemberId, individual.userId)
        .run(),
    ).rejects.toThrow("individual and organization representative capacities are mutually exclusive");
    expect(individual.userId).toBeTruthy();
  });
});
