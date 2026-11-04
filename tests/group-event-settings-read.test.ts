import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { grantGroupLeadershipCapacity, ensureGroupMembershipCapacity } from "./helpers/group-leadership";
import { insertOrgRepresentative } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { eventManagementDetailResponseSchema } from "../assets/shared/schemas/event-management";
import { computeGrantsForUser } from "../functions/_lib/auth/permissions";
import { grantResourceToGroup } from "../functions/_lib/services/resource-grants";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";

const groupId = "20000000-0000-4000-8000-000000000003";
const otherGroupId = "20000000-0000-4000-8000-000000000005";
async function fixture() {
  const { eventId, admin } = await seedEventAndAdmin(env.DB);
  await env.DB.prepare(
    "UPDATE events SET owner_group_id=?,source_mode='portal',profile_key='conference',visibility='invitation_only',updated_at=?,settings_json=? WHERE id=?",
  )
    .bind(
      groupId,
      new Date().toISOString(),
      JSON.stringify({ venue: "Private venue", internal: "private configuration" }),
      eventId,
    )
    .run();
  const email = `chair-${crypto.randomUUID()}@example.test`;
  const chair = { ...(await insertOrgRepresentative(env.DB, { category: "A", email })), email };
  const leadership = await grantGroupLeadershipCapacity(env.DB, groupId, chair.userId);
  const token = await createAdminSession(env.DB, chair.userId, crypto.randomUUID());
  return { eventId, admin, chair, leadership, token };
}
function read(token?: string, selectedGroup?: string) {
  return callApi(
    env,
    `/api/v1/events/pqc-2026${selectedGroup ? `?groupId=${selectedGroup}` : ""}`,
    {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    },
    { maxRoundTrips: 1 },
  );
}

describe("group event settings read authority", () => {
  beforeEach(resetDb);
  it("lets a chair load and save a private event's configuration through the same selected group", async () => {
    const { token, chair, leadership, eventId } = await fixture();
    expect(
      (await computeGrantsForUser(env.DB, chair.userId, leadership.memberId)).some(
        (grant) => grant.permission === "events:read",
      ),
    ).toBe(false);
    expect((await read(token)).status).toBe(404);
    const response = await read(token, groupId);
    expect(response.status, await response.clone().text()).toBe(200);
    const { event } = eventManagementDetailResponseSchema.parse(await response.json());
    expect(event.settings.internal).toBe("private configuration");
    expect(event.capabilities).toEqual(["read"]);
    const save = await callApi(env, `/api/v1/groups/${groupId}/events/${eventId}/settings`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: "Chair edited the event", expectedUpdatedAt: event.updatedAt }),
    });
    expect(save.status, await save.clone().text()).toBe(200);
    const updated = eventManagementDetailResponseSchema.parse(await (await read(token, groupId)).json());
    expect(updated.event.name).toBe("Chair edited the event");
  });

  it("denies anonymous users, ordinary group members, and another group's chair", async () => {
    const { token } = await fixture();
    expect((await read(undefined, groupId)).status).toBe(401);
    const member = await insertOrgRepresentative(env.DB, { category: "A" });
    await ensureGroupMembershipCapacity(env.DB, groupId, member.userId);
    const memberToken = await createMemberSession(env.DB, member.userId, crypto.randomUUID());
    expect((await read(memberToken, groupId)).status).toBe(403);
    expect((await read(token, otherGroupId)).status).toBe(403);
    await grantGroupLeadershipCapacity(env.DB, otherGroupId, member.userId);
    const otherToken = await createAdminSession(env.DB, member.userId, crypto.randomUUID());
    expect((await read(otherToken, groupId)).status).toBe(403);
  });

  it("requires an explicit manage delegation rather than view or attendance management", async () => {
    const { eventId, admin } = await fixture();
    const other = await insertOrgRepresentative(env.DB, { category: "A" });
    await grantGroupLeadershipCapacity(env.DB, otherGroupId, other.userId);
    const token = await createAdminSession(env.DB, other.userId, crypto.randomUUID());
    for (const capability of ["view", "manage_attendance"] as const) {
      await grantResourceToGroup(env.DB, admin, groupId, "event", eventId, {
        granteeGroupId: otherGroupId,
        capability,
      });
      expect((await read(token, otherGroupId)).status).toBe(403);
    }
    await grantResourceToGroup(env.DB, admin, groupId, "event", eventId, {
      granteeGroupId: otherGroupId,
      capability: "manage",
    });
    expect((await read(token, otherGroupId)).status).toBe(200);
  });

  it("rechecks leadership inside the protected read and denies revoked authority", async () => {
    const { token, leadership } = await fixture();
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("policy.user_retention_days"),
      async () => {
        await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE id=?")
          .bind(new Date().toISOString(), leadership.roleAssignmentId)
          .run();
      },
    );
    const response = await callApi(
      { ...env, DB: db },
      `/api/v1/events/pqc-2026?groupId=${groupId}`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
      { maxRoundTrips: 1 },
    );
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("private configuration");
  });
});
