import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupEventsListQuerySchema } from "../assets/shared/schemas/group-events";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { prepareValidatedAttendeeRegistration } from "../functions/_lib/services/attendee-registration";
import { createGroupEventSeries } from "../functions/_lib/services/event-series";
import { buildGroupEventsPageQuery } from "../functions/_lib/services/events/group-read-model";
import { replaceEventTerms } from "../functions/_lib/services/events";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import { commitRegistrationSubmission } from "../functions/_lib/services/registration-submission";
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
  eventSlug: string;
  memberId: string;
  memberEmail: string;
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
  const memberEmail = `group-event-member-${crypto.randomUUID()}@example.test`;
  const member = await insertOrgRepresentative(env.DB, { category: "A", email: memberEmail });
  await env.DB.prepare("UPDATE users SET first_name = 'Test', last_name = 'Member' WHERE id = ?")
    .bind(member.userId)
    .run();
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
  await replaceEventTerms(env.DB, series.eventId, "attendee", [
    { termKey: "meeting-terms", version: "1", displayText: "I accept the meeting terms" },
  ]);
  return {
    admin,
    ownerId: owner.id,
    granteeId: grantee.id,
    outsiderId: outsider.id,
    eventId: series.eventId,
    eventSlug: series.eventSlug,
    memberId: member.userId,
    memberEmail,
    memberToken: await createMemberSession(env.DB, member.userId, `group-event-member-${crypto.randomUUID()}`),
    leaderToken: await createAdminSession(env.DB, leader.id, `group-event-leader-${crypto.randomUUID()}`),
  };
}

function authenticatedRequest(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return callApi(env, path, { ...init, headers });
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

  it("registers the verified session identity without accepting identity overrides", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "register",
    });
    const path = `/api/v1/groups/${fixture.granteeId}/events/${fixture.eventId}/registrations`;
    const identityOverride = await authenticatedRequest(fixture.memberToken, path, {
      method: "POST",
      body: JSON.stringify({
        email: "someone-else@example.test",
        attendanceType: "virtual",
        consents: [{ termKey: "meeting-terms", version: "1" }],
      }),
    });
    expect(identityOverride.status).toBe(400);

    const registered = await authenticatedRequest(fixture.memberToken, path, {
      method: "POST",
      body: JSON.stringify({
        attendanceType: "virtual",
        consents: [{ termKey: "meeting-terms", version: "1" }],
      }),
    });
    expect(registered.status, await registered.clone().text()).toBe(200);
    expect(await registered.json()).toMatchObject({
      success: true,
      status: "registered",
      manageToken: null,
      manageUrl: null,
    });
    expect(
      await env.DB.prepare(
        `SELECT user_id, registration_group_id, status, confirmation_link_secret
           FROM registrations WHERE event_id = ?`,
      )
        .bind(fixture.eventId)
        .first(),
    ).toEqual({
      user_id: fixture.memberId,
      registration_group_id: fixture.granteeId,
      status: "registered",
      confirmation_link_secret: null,
    });
    const audit = await env.DB.prepare(
      `SELECT scope_type, scope_id, details_json
         FROM audit_log WHERE action = 'registration_created' AND actor_id = ?`,
    )
      .bind(fixture.memberId)
      .first<{ scope_type: string; scope_id: string; details_json: string }>();
    expect(audit).toMatchObject({ scope_type: "group", scope_id: fixture.granteeId });
    expect(JSON.parse(audit!.details_json)).toMatchObject({
      registrationGroupId: { from: null, to: fixture.granteeId },
    });
  });

  it("rejects disabled, ungranted, public, and concurrently revoked registration paths", async () => {
    const fixture = await createFixture();
    const groupPath = `/api/v1/groups/${fixture.granteeId}/events/${fixture.eventId}/registrations`;
    const payload = {
      attendanceType: "virtual" as const,
      consents: [{ termKey: "meeting-terms", version: "1" }],
    };
    const ungranted = await authenticatedRequest(fixture.memberToken, groupPath, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(ungranted.status).toBe(404);

    const publicAttempt = await callApi(env, `/api/v1/events/${fixture.eventSlug}/registrations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Public",
        lastName: "Visitor",
        email: "visitor@example.test",
        ...payload,
      }),
    });
    expect(publicAttempt.status).toBe(403);

    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "register",
    });
    const prepared = await prepareValidatedAttendeeRegistration(
      env.DB,
      {
        firstName: "Test",
        lastName: "Member",
        email: fixture.memberEmail,
        ...payload,
      },
      {
        eventId: fixture.eventId,
        invite: null,
        sourceType: "direct",
        sourceRef: `group:${fixture.granteeId}`,
        ip: null,
        userAgent: null,
        signingSecret: "test-signing-secret",
        pendingConfirmationDeadlineHours: 24,
        confirmationTtlHours: 24,
        referralCodeLength: 8,
        verifiedIdentity: { userId: fixture.memberId, registrationGroupId: fixture.granteeId },
      },
    );
    await revokeResourceGroupGrant(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "register",
    });
    await expect(commitRegistrationSubmission(env.DB, prepared.prepared)).rejects.toMatchObject({
      status: 409,
      code: "EVENT_REGISTRATION_CONTEXT_CHANGED",
    });
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM registrations WHERE event_id = ?")
      .bind(fixture.eventId)
      .first<{ count: number }>();
    expect(count?.count).toBe(0);

    await env.DB.prepare("UPDATE events SET registration_mode = 'no_registration' WHERE id = ?")
      .bind(fixture.eventId)
      .run();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "register",
    });
    const disabled = await authenticatedRequest(fixture.memberToken, groupPath, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(disabled.status).toBe(403);
  });
});
