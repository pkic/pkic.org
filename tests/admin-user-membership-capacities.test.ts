import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { userDetailSchema } from "../assets/shared/schemas/user-management";
import { getUserDetail } from "../functions/_lib/services/user-management-detail";
import { createOrganizationIdentity } from "../functions/_lib/services/identities";
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
  const identity = await env.DB.prepare(
    "SELECT identity_id FROM identity_member_capacities WHERE user_id = ? AND member_id = ?",
  )
    .bind(userId, memberId)
    .first<{ identity_id: string }>();
  if (!identity) throw new Error("Active identity fixture required");
  await env.DB.prepare(
    `INSERT INTO group_memberships
       (id, group_id, user_id, identity_id, member_id, source, joined_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'staff', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), groupId, userId, identity.identity_id, memberId, at, at, at)
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
      `UPDATE identities
          SET job_title = CASE organization_id WHEN ? THEN 'Organization A role' ELSE 'Organization B role' END,
              biography = CASE organization_id WHEN ? THEN 'Organization A bio' ELSE 'Organization B bio' END,
              links_json = CASE organization_id
                WHEN ? THEN '["https://a.example.test/profile"]'
                ELSE '["https://b.example.test/profile"]'
              END
        WHERE user_id = ?`,
    )
      .bind(organizationA, organizationA, organizationA, userId)
      .run();
    await joinGroup("20000000-0000-4000-8000-000000000003", userId, memberA);
    await joinGroup("20000000-0000-4000-8000-000000000004", userId, memberB);

    const detail = userDetailSchema.parse(await getUserDetail(env.DB, userId));

    expect(detail.identities).toHaveLength(2);
    const byOrganization = new Map(detail.identities.map((identity) => [identity.organizationName, identity]));
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

  it("rejects granting an individual membership to an active organization identity", async () => {
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
    await expect(
      grantIndividualMembership(env.DB, actor, {
        userId,
        membershipCategory: "H6",
        activationReason: "Test individual activation",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "IDENTITY_CONFLICT",
    });
    await expect(
      env.DB.prepare(
        `INSERT INTO members (id, member_type, user_id, status, created_at, updated_at)
         VALUES (?, 'individual', ?, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), userId)
        .run(),
    ).rejects.toThrow("individual and organization identities are mutually exclusive");
  });

  it("rejects adding an organization representation to an active individual member", async () => {
    const actorUserId = await insertUser(env.DB, "capacity-admin@example.test");
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorUserId,
      email: "capacity-admin@example.test",
      role: "admin",
    };
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(actorUserId).run();
    const individual = await insertIndividualMember(env.DB, "H6", "individual-conflict@example.test");
    const organizationId = await insertOrganization(env.DB, "Individual Conflict Organization");
    await seedOrganizationAggregate(env.DB, organizationId, "A");

    await expect(
      createOrganizationIdentity(
        env.DB,
        {
          userId: actorUserId,
          databaseUserId: actorUserId,
          actorType: "admin",
          staffAuthorized: true,
          immediateActivationAuthorized: true,
          permissionActor: actor,
        },
        {
          organizationId,
          userId: individual.userId,
          showOnOrganizationProfile: true,
          activation: { mode: "immediate", reason: "Test organization activation" },
        },
      ),
    ).rejects.toMatchObject({ status: 409, code: "IDENTITY_CONFLICT" });
    await expect(
      env.DB.prepare(
        `INSERT INTO identities
           (id, user_id, organization_id, source, invited_at, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'staff', datetime('now'), datetime('now'), datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), individual.userId, organizationId)
        .run(),
    ).rejects.toThrow("individual and organization identities are mutually exclusive");
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
    const mutation = grantIndividualMembership(gate.db, actor, {
      userId: targetUserId,
      membershipCategory: "H6",
      activationReason: "Test race activation",
    });
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
    const mutation = updateMembershipCapacity(gate.db, actor, target.identityId, { membershipCategory: "H7" });
    await gate.reached;
    await env.DB.prepare("UPDATE members SET status = 'inactive', updated_at = datetime('now') WHERE id = ?")
      .bind(target.memberId)
      .run();
    gate.release();

    await expect(mutation).rejects.toMatchObject({ status: 409, code: "IDENTITY_CHANGED" });
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

    await expect(
      updateMembershipCapacity(env.DB, actor, target.identityId, { status: "active" }),
    ).rejects.toMatchObject({
      status: 404,
      code: "IDENTITY_NOT_FOUND",
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
      updateMembershipCapacity(env.DB, actor, target.identityId, { status: "inactive" }),
    ).resolves.toMatchObject({
      id: target.identityId,
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
    const identityId = await addRepresentative(env.DB, memberId, representedUserId);
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "representative-response-admin@example.test",
      role: "admin",
    };

    await expect(
      updateMembershipCapacity(env.DB, actor, identityId, { showOnOrgProfile: false }),
    ).resolves.toMatchObject({
      id: identityId,
      organizationId,
      membershipCategory: "A",
      status: "active",
      showOnOrgProfile: false,
    });
  });
});
