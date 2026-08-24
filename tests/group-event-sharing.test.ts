import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupEventsListQuerySchema } from "../assets/shared/schemas/group-events";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { createGroupEventSeries } from "../functions/_lib/services/event-series";
import { buildGroupEventsPageQuery } from "../functions/_lib/services/events/group-read-model";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import { grantResourceToGroup, revokeResourceGroupGrant } from "../functions/_lib/services/resource-grants";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { insertOrgRepresentative, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

interface Fixture {
  admin: UserBackedAuthAdmin;
  ownerId: string;
  granteeId: string;
  outsiderId: string;
  eventId: string;
  memberToken: string;
  leaderToken: string;
}

async function userActor(label: string, role = "user"): Promise<UserBackedAuthAdmin> {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const id = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
  return { identityType: "user", id, email, role };
}

async function createFixture(): Promise<Fixture> {
  const admin = await userActor("group-event-admin", "admin");
  const owner = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Event owner ${crypto.randomUUID()}`,
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const grantee = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Event grantee ${crypto.randomUUID()}`,
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const outsider = await createGroup(env.DB, admin, {
    typeKey: "working_group",
    name: `Event outsider ${crypto.randomUUID()}`,
    visibility: "authenticated",
    eligibilityMode: "open",
  });
  const member = await insertOrgRepresentative(env.DB, { category: "A" });
  await joinGroup(env.DB, grantee.id, {
    actorUserId: member.userId,
    targetUserId: member.userId,
    selection: { mode: "all_eligible", confirmed: true },
    source: "self_service",
    allowManaged: false,
  });
  const leader = await userActor("group-event-leader");
  await env.DB.prepare(
    `INSERT INTO user_roles
       (id, user_id, role_id, context_type, context_id, single_holder_per_context, created_at)
     VALUES (?, ?, 'role-group_lead', 'group', ?, 0, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), leader.id, grantee.id)
    .run();
  const series = await createGroupEventSeries(env.DB, admin, owner.id, {
    eventName: "Shared architecture workshop",
    eventSlug: `shared-architecture-${crypto.randomUUID()}`,
    profileKey: "workshop",
    policy: {
      registrationPolicy: "optional",
      memberEligibility: "shared_groups",
      guestPolicy: "public_registration",
    },
    startsAt: "2027-01-10T10:00:00.000Z",
    recurrenceRule: "FREQ=WEEKLY;COUNT=2",
    timezone: "Europe/Amsterdam",
    durationMinutes: 60,
    location: "Online",
    providerType: null,
  });
  await env.DB.prepare("UPDATE events SET links_json = ? WHERE id = ?")
    .bind(JSON.stringify(["https://example.test/workshop"]), series.eventId)
    .run();
  return {
    admin,
    ownerId: owner.id,
    granteeId: grantee.id,
    outsiderId: outsider.id,
    eventId: series.eventId,
    memberToken: await createMemberSession(env.DB, member.userId, `group-event-member-${crypto.randomUUID()}`),
    leaderToken: await createAdminSession(env.DB, leader.id, `group-event-leader-${crypto.randomUUID()}`),
  };
}

function authenticatedRequest(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(resetDb);

describe("group event sharing", () => {
  it("discovers and reads an event only through the selected member grant context", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "register",
    });

    const query = buildGroupEventsPageQuery(
      fixture.granteeId,
      { member: true, manager: false },
      groupEventsListQuerySchema.parse({ q: "architecture", limit: 20 }),
    );
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);
    const [pagePlan, countPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, query.limit, query.offset)
        .all<{ detail: string }>(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...countBindings)
        .all<{ detail: string }>(),
    ]);
    const plan = [...pagePlan.results, ...countPlan.results].map((row) => row.detail).join("\n");
    expect(plan).toContain("idx_events_owner_profile");
    expect(plan).toContain("idx_event_group_grants_group");

    const list = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.granteeId}/events?q=architecture&profileKey=workshop&sort=name&limit=20`,
    );
    expect(list.status, await list.clone().text()).toBe(200);
    expect(await list.json()).toMatchObject({
      events: [
        {
          id: fixture.eventId,
          ownerGroupId: fixture.ownerId,
          registrationPolicy: "optional",
          location: "Online",
          links: ["https://example.test/workshop"],
          capabilities: ["view", "register"],
        },
      ],
      page: { total: 1, hasMore: false },
    });

    const detail = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.granteeId}/events/${fixture.eventId}`,
    );
    expect(detail.status, await detail.clone().text()).toBe(200);
    expect(await detail.json()).toMatchObject({ event: { id: fixture.eventId, capabilities: ["view", "register"] } });

    const wrongContext = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.outsiderId}/events/${fixture.eventId}`,
    );
    expect(wrongContext.status).toBe(404);

    await revokeResourceGroupGrant(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "register",
    });
    const revoked = await authenticatedRequest(fixture.memberToken, `/api/v1/groups/${fixture.granteeId}/events`);
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ events: [], page: { total: 0 } });
  });

  it("keeps attendance management separate from member participation", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage_attendance",
    });

    const memberList = await authenticatedRequest(fixture.memberToken, `/api/v1/groups/${fixture.granteeId}/events`);
    expect(memberList.status).toBe(200);
    expect(await memberList.json()).toMatchObject({ events: [], page: { total: 0 } });

    const leaderList = await authenticatedRequest(fixture.leaderToken, `/api/v1/groups/${fixture.granteeId}/events`);
    expect(leaderList.status, await leaderList.clone().text()).toBe(200);
    expect(await leaderList.json()).toMatchObject({
      events: [{ id: fixture.eventId, capabilities: ["view", "manage_attendance"] }],
      page: { total: 1 },
    });
  });
});
