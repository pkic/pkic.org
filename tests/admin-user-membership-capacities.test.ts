import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { userDetailSchema } from "../assets/shared/schemas/user-management";
import { getUserDetail } from "../functions/_lib/services/user-management-detail";
import { addOrganizationRepresentative } from "../functions/_lib/services/organization-management/representative-provisioning";
import { grantIndividualMembership, updateMembershipCapacity } from "../functions/_lib/services/membership/capacities";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";
import { gateNextBatch } from "./helpers/d1-batch-gate";
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
    await env.DB.prepare(
      `UPDATE organization_representatives
          SET job_title = CASE member_id WHEN ? THEN 'Organization A role' ELSE 'Organization B role' END,
              biography = CASE member_id WHEN ? THEN 'Organization A bio' ELSE 'Organization B bio' END,
              links_json = CASE member_id
                WHEN ? THEN '["https://a.example.test/profile"]'
                ELSE '["https://b.example.test/profile"]'
              END
        WHERE user_id = ?`,
    )
      .bind(memberA, memberA, memberA, userId)
      .run();
    await joinGroup("20000000-0000-4000-8000-000000000003", userId, memberA);
    await joinGroup("20000000-0000-4000-8000-000000000004", userId, memberB);

    const detail = userDetailSchema.parse(await getUserDetail(env.DB, userId));

    expect(detail.memberships).toHaveLength(2);
    const byOrganization = new Map(detail.memberships.map((membership) => [membership.organizationName, membership]));
    expect(byOrganization.get("Capacity Organization A")?.groups.map((group) => group.slug)).toEqual(["pqc"]);
    expect(byOrganization.get("Capacity Organization B")?.groups.map((group) => group.slug)).toEqual(["cm"]);
    expect(byOrganization.get("Capacity Organization A")).toMatchObject({
      email: "multiple-organizations@example.test",
      jobTitle: "Organization A role",
      biography: "Organization A bio",
      links: ["https://a.example.test/profile"],
    });
    expect(byOrganization.get("Capacity Organization B")).toMatchObject({
      email: "multiple-organizations@example.test",
      jobTitle: "Organization B role",
      biography: "Organization B bio",
      links: ["https://b.example.test/profile"],
    });
  });

  it("rejects granting an individual membership to an active organization representative", async () => {
    const userId = await insertUser(env.DB, "representative-conflict@example.test");
    const organizationId = await insertOrganization(env.DB, "Representative Conflict Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);

    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: userId,
      email: "representative-conflict@example.test",
      role: "admin",
    };
    await expect(grantIndividualMembership(env.DB, actor, userId, "H6")).rejects.toMatchObject({
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
    const actor: UserBackedAuthAdmin = {
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

  it("does not create an individual capacity after its target is anonymized during the commit race", async () => {
    const actorId = await insertUser(env.DB, "membership-race-admin@example.test");
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(actorId).run();
    const targetUserId = await insertUser(env.DB, "membership-race-target@example.test");
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "membership-race-admin@example.test",
      role: "admin",
    };
    const gate = gateNextBatch(env.DB);
    const mutation = grantIndividualMembership(gate.db, actor, targetUserId, "H6");
    await gate.reached;
    await env.DB.prepare(
      "UPDATE users SET pii_redacted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    )
      .bind(targetUserId)
      .run();
    gate.release();

    await expect(mutation).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_TARGET_CHANGED" });
    expect((await env.DB.prepare("SELECT id FROM members WHERE user_id = ?").bind(targetUserId).all()).results).toEqual(
      [],
    );
  });

  it("does not re-enroll a capacity after it is concurrently offboarded", async () => {
    const actorId = await insertUser(env.DB, "membership-update-race-admin@example.test");
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(actorId).run();
    const target = await insertIndividualMember(env.DB, "H6", "membership-update-race-target@example.test");
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "membership-update-race-admin@example.test",
      role: "admin",
    };
    const gate = gateNextBatch(env.DB);
    const mutation = updateMembershipCapacity(gate.db, actor, target.memberId, { membershipCategory: "H7" });
    await gate.reached;
    await env.DB.prepare("UPDATE members SET status = 'inactive', updated_at = datetime('now') WHERE id = ?")
      .bind(target.memberId)
      .run();
    gate.release();

    await expect(mutation).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_CAPACITY_CHANGED" });
    expect(
      await env.DB.prepare("SELECT category_code FROM member_category_assignments WHERE member_id = ?")
        .bind(target.memberId)
        .first(),
    ).toMatchObject({ category_code: "H6" });
  });

  it.each([
    {
      name: "deactivated",
      mutation: "UPDATE users SET active = 0, updated_at = datetime('now') WHERE id = ?",
    },
    {
      name: "anonymized",
      mutation: "UPDATE users SET pii_redacted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
    },
  ])("does not reactivate or enroll a $name capacity", async ({ mutation }) => {
    const actorId = await insertUser(env.DB, "membership-lifecycle-admin@example.test");
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(actorId).run();
    const target = await insertIndividualMember(env.DB, "H6", "membership-lifecycle-target@example.test");
    await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(target.memberId).run();
    await env.DB.prepare(mutation).bind(target.userId).run();
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "membership-lifecycle-admin@example.test",
      role: "admin",
    };

    await expect(updateMembershipCapacity(env.DB, actor, target.memberId, { status: "active" })).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    await expect(
      env.DB.prepare("SELECT status FROM members WHERE id = ?").bind(target.memberId).first(),
    ).resolves.toMatchObject({
      status: "inactive",
    });
    expect(
      (await env.DB.prepare("SELECT id FROM group_memberships WHERE user_id = ?").bind(target.userId).all()).results,
    ).toEqual([]);
  });

  it("returns the existing category for a status-only individual capacity update", async () => {
    const actorId = await insertUser(env.DB, "membership-response-admin@example.test");
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(actorId).run();
    const target = await insertIndividualMember(env.DB, "H6", "membership-response-target@example.test");
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "membership-response-admin@example.test",
      role: "admin",
    };

    await expect(
      updateMembershipCapacity(env.DB, actor, target.memberId, { status: "inactive" }),
    ).resolves.toMatchObject({
      id: target.memberId,
      membershipCategory: "H6",
      status: "inactive",
    });
  });

  it("returns the organization aggregate category and status for a representative update", async () => {
    const actorId = await insertUser(env.DB, "representative-response-admin@example.test");
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(actorId).run();
    const representedUserId = await insertUser(env.DB, "representative-response-target@example.test");
    const organizationId = await insertOrganization(env.DB, "Representative Response Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const representativeId = await addRepresentative(env.DB, memberId, representedUserId);
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "representative-response-admin@example.test",
      role: "admin",
    };

    await expect(
      updateMembershipCapacity(env.DB, actor, representativeId, { showOnOrgProfile: false }),
    ).resolves.toMatchObject({
      id: representativeId,
      organizationId,
      membershipCategory: "A",
      status: "active",
      showOnOrgProfile: false,
    });
  });
});
