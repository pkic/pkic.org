import app from "./helpers/app";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { JOB_TITLE_REQUIRED } from "../assets/shared/schemas/identity-job-title";
import { administratorGrants, grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { memberCapacityMutationResponseSchema } from "../assets/shared/schemas/membership-management";
import { userDetailSchema } from "../assets/shared/schemas/user-management";
import { getUserDetail } from "../functions/_lib/services/user-management-detail";
import { createOrganizationIdentity } from "../functions/_lib/services/identities";
import {
  grantIndividualMembership,
  updateMembershipCapacity,
  removeMembershipCapacity,
} from "../functions/_lib/services/membership/capacities";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { resetDb } from "./helpers/reset-db";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { prepareIndividualIdentityStatement } from "../functions/_lib/services/users";
import { nowIso } from "../functions/_lib/utils/time";
import {
  addRepresentative,
  INDIVIDUAL_MEMBERSHIPS_OF_USER_SQL,
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

async function publicationStaff() {
  const userId = await insertUser(env.DB, "publication-staff@example.test");
  await grantAdministrator(env.DB, userId);
  const token = await createAdminSession(env.DB, userId, "capacity-publication-staff");
  const actor: UserBackedAuthAdmin = {
    identityType: "user",
    id: userId,
    email: "publication-staff@example.test",
    grants: administratorGrants,
  };
  return { token, actor };
}
function capacityRequest(token: string, path: string, method: string, body?: unknown) {
  return callApi(env, `/api/v1/members/capacities${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function publicationRequests() {
  return (await env.DB.prepare("SELECT resource_id,reason_code FROM site_publication_requests ORDER BY sequence").all())
    .results;
}

describe("admin user membership capacities", () => {
  beforeEach(resetDb);

  it("publishes changed individual capacity data while no-op and private changes stay quiet", async () => {
    const { token } = await publicationStaff();
    const target = await insertIndividualMember(env.DB, "H6", "capacity-publication@example.test");
    const save = async (body: unknown) => {
      const response = await capacityRequest(token, `/${target.identityId}`, "PATCH", body);
      expect(response.status, await response.clone().text()).toBe(200);
    };
    await save({ status: "active", membershipCategory: "H6", profile: { biography: null, links: [] } });
    expect(await publicationRequests()).toHaveLength(0);
    const profile = { biography: "Public biography", links: ["https://example.test/profile"] };
    await save({ profile });
    expect(await publicationRequests()).toEqual([{ resource_id: target.memberId, reason_code: "membership_changed" }]);
    await save({ profile });
    expect(await publicationRequests()).toHaveLength(1);
    await save({ membershipCategory: "H7" });
    expect(await publicationRequests()).toHaveLength(2);
    await save({ status: "inactive" });
    expect(await publicationRequests()).toHaveLength(3);
    await save({ membershipCategory: "H6", profile: { biography: "Private change" } });
    expect(await publicationRequests()).toHaveLength(3);
    await save({ status: "active" });
    expect(await publicationRequests()).toHaveLength(4);
  });

  it("publishes organization roster visibility changes only while membership is public", async () => {
    const { token } = await publicationStaff();
    const userId = await insertUser(env.DB, "roster-capacity@example.test");
    const memberId = await seedOrganizationAggregate(env.DB, await insertOrganization(env.DB));
    const identityId = await addRepresentative(env.DB, memberId, userId, { jobTitle: "Engineer" });
    const save = async (showOnOrgProfile: boolean) => {
      const response = await capacityRequest(token, `/${identityId}`, "PATCH", { showOnOrgProfile });
      expect(response.status, await response.clone().text()).toBe(200);
    };
    await save(true);
    expect(await publicationRequests()).toHaveLength(0);
    await save(false);
    expect(await publicationRequests()).toHaveLength(1);
    await save(false);
    expect(await publicationRequests()).toHaveLength(1);
    await save(true);
    expect(await publicationRequests()).toHaveLength(2);
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(memberId).run();
    await save(false);
    expect(await publicationRequests()).toHaveLength(2);
  });

  it("publishes a new individual grant once and refuses a repeated grant without side effects", async () => {
    const { token } = await publicationStaff();
    const userId = await insertUser(env.DB, "new-capacity@example.test");
    const body = { userId, membershipCategory: "H6", activationReason: "Reviewed membership" };
    const created = await capacityRequest(token, "", "POST", body);
    expect(created.status, await created.clone().text()).toBe(201);
    const { member } = memberCapacityMutationResponseSchema.parse(await created.json());
    const memberId = await env.DB.prepare("SELECT id FROM members WHERE identity_id=?").bind(member.id).first("id");
    expect(await publicationRequests()).toEqual([{ resource_id: memberId, reason_code: "membership_changed" }]);
    const repeated = await capacityRequest(token, "", "POST", body);
    expect(repeated.status).toBe(409);
    expect(await publicationRequests()).toHaveLength(1);
  });

  it("grants membership to an attendee's existing personal identity without replacing its profile or references", async () => {
    const { token } = await publicationStaff();
    const userId = await insertUser(env.DB, "attendee-membership@example.test");
    await env.DB.batch([prepareIndividualIdentityStatement(env.DB, userId, nowIso())]);
    const identityId = await env.DB.prepare("SELECT id FROM identities WHERE user_id=? AND organization_id IS NULL")
      .bind(userId)
      .first<string>("id");
    await env.DB.prepare("UPDATE identities SET biography='Existing attendee biography' WHERE id=?")
      .bind(identityId)
      .run();
    const created = await capacityRequest(token, "", "POST", {
      userId,
      membershipCategory: "H6",
      activationReason: "Reviewed attendee application",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const result = memberCapacityMutationResponseSchema.parse(await created.json());
    expect(result.member.id).toBe(identityId);
    expect(
      (await env.DB.prepare("SELECT id,biography FROM identities WHERE user_id=?").bind(userId).all()).results,
    ).toEqual([{ id: identityId, biography: "Existing attendee biography" }]);
  });

  it.each(["individual", "organization", "hidden", "inactive"] as const)(
    "queues removal only for a public capacity: %s",
    async (visibility) => {
      const { token } = await publicationStaff();
      let target: { identityId: string; memberId: string };
      if (visibility === "individual" || visibility === "inactive") {
        target = await insertIndividualMember(env.DB, "H6", "removed-capacity@example.test");
        if (visibility === "inactive")
          await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(target.memberId).run();
      } else {
        const userId = await insertUser(env.DB, "removed-representative@example.test");
        const memberId = await seedOrganizationAggregate(env.DB, await insertOrganization(env.DB));
        target = {
          memberId,
          identityId: await addRepresentative(env.DB, memberId, userId, { showOnOrgProfile: visibility !== "hidden" }),
        };
      }
      const denied = await callApi(env, `/api/v1/members/capacities/${target.identityId}`, { method: "DELETE" });
      expect(denied.status).toBe(401);
      expect(await publicationRequests()).toHaveLength(0);
      const response = await capacityRequest(token, `/${target.identityId}`, "DELETE");
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await publicationRequests()).toEqual(
        visibility === "individual" || visibility === "organization"
          ? [{ resource_id: target.memberId, reason_code: "membership_changed" }]
          : [],
      );
    },
  );

  it.each(["grant", "update", "remove"] as const)(
    "rolls back %s when its publication request cannot be committed",
    async (operation) => {
      const { token } = await publicationStaff();
      const target =
        operation === "grant"
          ? { userId: await insertUser(env.DB, "atomic-grant@example.test"), identityId: "" }
          : await insertIndividualMember(env.DB, "H6", "atomic-capacity@example.test");
      const state = async () => ({
        identities: (
          await env.DB.prepare("SELECT id,started_at,ended_at,biography,updated_at FROM identities WHERE user_id=?")
            .bind(target.userId)
            .all()
        ).results,
        members: (
          await env.DB.prepare(
            "SELECT member.id,member.status,assignment.category_code FROM members member JOIN member_category_assignments assignment ON assignment.member_id=member.id LEFT JOIN identities identity ON identity.id=member.identity_id WHERE identity.user_id=?",
          )
            .bind(target.userId)
            .all()
        ).results,
      });
      const before = await state();
      await env.DB.prepare(`CREATE TRIGGER fail_capacity_publication BEFORE INSERT ON site_publication_requests
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CAPACITY_PUBLICATION_FAILURE'); END`).run();
      try {
        const response =
          operation === "grant"
            ? await capacityRequest(token, "", "POST", {
                userId: target.userId,
                membershipCategory: "H6",
                activationReason: "Reviewed grant",
              })
            : await capacityRequest(
                token,
                `/${target.identityId}`,
                operation === "remove" ? "DELETE" : "PATCH",
                operation === "update"
                  ? { membershipCategory: "H7", profile: { biography: "Must roll back" } }
                  : undefined,
              );
        expect(response.status).toBe(500);
        expect(await state()).toEqual(before);
        expect(await publicationRequests()).toHaveLength(0);
        expect(
          (
            await env.DB.prepare(
              "SELECT id FROM audit_log WHERE entity_type='identity' AND action IN ('identity_updated','identity_ended','individual_identity_activated')",
            ).all()
          ).results,
        ).toHaveLength(0);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_capacity_publication").run();
      }
    },
  );

  it("leaves no removal request when a concurrent identity edit wins", async () => {
    const { actor } = await publicationStaff();
    const target = await insertIndividualMember(env.DB, "H6", "removal-race@example.test");
    const gate = gateNextBatch(env.DB);
    const mutation = removeMembershipCapacity(gate.db, actor, target.identityId);
    await gate.reached;
    await env.DB.prepare("UPDATE identities SET updated_at='2099-01-01T00:00:00.000Z' WHERE id=?")
      .bind(target.identityId)
      .run();
    gate.release();
    await expect(mutation).rejects.toMatchObject({ status: 409, code: "IDENTITY_CHANGED" });
    expect(
      await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(target.identityId).first("ended_at"),
    ).toBeNull();
    expect(await publicationRequests()).toHaveLength(0);
  });

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
      grants: administratorGrants,
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
    expect(await env.DB.prepare(INDIVIDUAL_MEMBERSHIPS_OF_USER_SQL).bind(userId).first()).toBeNull();
  });

  it("adds an organization identity to an existing individual member without rewriting either relationship", async () => {
    const actorUserId = await insertUser(env.DB, "capacity-admin@example.test");
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorUserId,
      email: "capacity-admin@example.test",
      grants: administratorGrants,
    };
    await grantAdministrator(env.DB, actorUserId);
    const individual = await insertIndividualMember(env.DB, "H6", "individual-conflict@example.test");
    const organizationId = await insertOrganization(env.DB, "Individual Conflict Organization");
    await seedOrganizationAggregate(env.DB, organizationId, "A");

    const result = await createOrganizationIdentity(
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
    );
    expect(result.state).toBe("active");
    expect(
      await env.DB.prepare("SELECT organization_id,user_id FROM identities WHERE id=?").bind(result.identityId).first(),
    ).toEqual({ organization_id: organizationId, user_id: individual.userId });
    expect(
      await env.DB.prepare("SELECT user_id,organization_id,ended_at FROM identities WHERE id=?")
        .bind(individual.identityId)
        .first(),
    ).toEqual({ user_id: individual.userId, organization_id: null, ended_at: null });
    expect(await env.DB.prepare("SELECT status FROM members WHERE id=?").bind(individual.memberId).first()).toEqual({
      status: "active",
    });
  });

  it("does not create an individual capacity after its target is anonymized during the commit race", async () => {
    const actorId = await insertUser(env.DB, "membership-race-admin@example.test");
    await grantAdministrator(env.DB, actorId);
    const targetUserId = await insertUser(env.DB, "membership-race-target@example.test");
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "membership-race-admin@example.test",
      grants: administratorGrants,
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
    expect((await env.DB.prepare(INDIVIDUAL_MEMBERSHIPS_OF_USER_SQL).bind(targetUserId).all()).results).toEqual([]);
    expect(await publicationRequests()).toHaveLength(0);
  });

  it("does not re-enroll a capacity after it is concurrently offboarded", async () => {
    const actorId = await insertUser(env.DB, "membership-update-race-admin@example.test");
    await grantAdministrator(env.DB, actorId);
    const target = await insertIndividualMember(env.DB, "H6", "membership-update-race-target@example.test");
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "membership-update-race-admin@example.test",
      grants: administratorGrants,
    };
    const gate = gateNextBatch(env.DB);
    const mutation = updateMembershipCapacity(gate.db, actor, target.identityId, { membershipCategory: "H7" });
    await gate.reached;
    await env.DB.prepare("UPDATE members SET status = 'inactive', updated_at = datetime('now') WHERE id = ?")
      .bind(target.memberId)
      .run();
    gate.release();

    await expect(mutation).rejects.toMatchObject({ status: 409, code: "IDENTITY_CHANGED" });
    expect(await publicationRequests()).toHaveLength(0);
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
    await grantAdministrator(env.DB, actorId);
    const target = await insertIndividualMember(env.DB, "H6", "membership-lifecycle-target@example.test");
    await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(target.memberId).run();
    await env.DB.prepare(mutation).bind(target.userId).run();
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "membership-lifecycle-admin@example.test",
      grants: administratorGrants,
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
    await grantAdministrator(env.DB, actorId);
    const target = await insertIndividualMember(env.DB, "H6", "membership-response-target@example.test");
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "membership-response-admin@example.test",
      grants: administratorGrants,
    };

    await expect(
      updateMembershipCapacity(env.DB, actor, target.identityId, { status: "inactive" }),
    ).resolves.toMatchObject({
      id: target.identityId,
      membershipCategory: "H6",
      status: "inactive",
    });
  });

  it("writes an individual capacity's own profile and leaves untouched fields alone", async () => {
    const actorId = await insertUser(env.DB, "profile-admin@example.test");
    await grantAdministrator(env.DB, actorId);
    const target = await insertIndividualMember(env.DB, "H6", "profile-target@example.test");
    await env.DB.prepare("UPDATE identities SET links_json = '[\"https://kept.example/\"]' WHERE id = ?")
      .bind(target.identityId)
      .run();
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "profile-admin@example.test",
      grants: administratorGrants,
    };

    await updateMembershipCapacity(env.DB, actor, target.identityId, {
      profile: { biography: "Independent researcher in applied cryptography." },
    });

    const row = await env.DB.prepare("SELECT biography, links_json FROM identities WHERE id = ?")
      .bind(target.identityId)
      .first<{ biography: string | null; links_json: string | null }>();
    expect(row).toEqual({
      biography: "Independent researcher in applied cryptography.",
      links_json: JSON.stringify(["https://kept.example/"]),
    });
  });

  it("refuses to write a representative's profile through the capacity route", async () => {
    const actorId = await insertUser(env.DB, "representative-profile-admin@example.test");
    await grantAdministrator(env.DB, actorId);
    const representedUserId = await insertUser(env.DB, "representative-profile-target@example.test");
    const organizationId = await insertOrganization(env.DB, "Representative Profile Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const identityId = await addRepresentative(env.DB, memberId, representedUserId);
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "representative-profile-admin@example.test",
      grants: administratorGrants,
    };

    await expect(
      updateMembershipCapacity(env.DB, actor, identityId, { profile: { biography: "Not through here" } }),
    ).rejects.toMatchObject({ status: 422, code: "IDENTITY_PROFILE_MANAGED_BY_ORGANIZATION" });
  });

  it.each([
    { title: null, visible: true },
    { title: null, visible: false },
    { title: "   ", visible: true },
    { title: "   ", visible: false },
  ])(
    "requires an organization title before a capacity visibility edit ($title, $visible)",
    async ({ title, visible }) => {
      const actorId = await insertUser(env.DB, "capacity-title-admin@example.test");
      await grantAdministrator(env.DB, actorId);
      const userId = await insertUser(env.DB, "capacity-title-target@example.test");
      const organizationId = await insertOrganization(env.DB, "Capacity Title Organization");
      const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
      const identityId = await addRepresentative(env.DB, memberId, userId);
      await env.DB.prepare("UPDATE identities SET job_title = ?, show_on_organization_profile = ? WHERE id = ?")
        .bind(title, visible ? 0 : 1, identityId)
        .run();
      const readIdentity = () => env.DB.prepare("SELECT * FROM identities WHERE id = ?").bind(identityId).first();
      const before = await readIdentity();
      const token = await createAdminSession(env.DB, actorId, crypto.randomUUID());
      const response = await app.fetch(
        new Request(`https://app.test/api/v1/members/capacities/${identityId}`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ showOnOrgProfile: visible }),
        }),
        env as never,
        { passThroughOnException: () => undefined, waitUntil: () => undefined } as never,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR", message: JOB_TITLE_REQUIRED },
      });
      expect(await readIdentity()).toEqual(before);
      expect(await env.DB.prepare("SELECT id FROM audit_log WHERE entity_id = ?").bind(identityId).all()).toMatchObject(
        { results: [] },
      );
    },
  );

  it("returns the organization aggregate category and status for a representative update", async () => {
    const actorId = await insertUser(env.DB, "representative-response-admin@example.test");
    await grantAdministrator(env.DB, actorId);
    const representedUserId = await insertUser(env.DB, "representative-response-target@example.test");
    const organizationId = await insertOrganization(env.DB, "Representative Response Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const identityId = await addRepresentative(env.DB, memberId, representedUserId);
    await env.DB.prepare("UPDATE identities SET job_title = ? WHERE id = ?").bind("Representative", identityId).run();
    const actor: UserBackedAuthAdmin = {
      identityType: "user",
      id: actorId,
      email: "representative-response-admin@example.test",
      grants: administratorGrants,
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
