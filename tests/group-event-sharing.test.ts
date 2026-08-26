import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  eventAttendanceListQuerySchema,
  eventOccurrenceGuestsListQuerySchema,
  eventOccurrencesListQuerySchema,
  eventSeriesListQuerySchema,
} from "../assets/shared/schemas/event-series";
import { groupEventsListQuerySchema } from "../assets/shared/schemas/group-events";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { prepareValidatedAttendeeRegistration } from "../functions/_lib/services/attendee-registration";
import {
  buildGroupEventSeriesPageQuery,
  buildOccurrenceGuestsPageQuery,
  buildOccurrenceAttendancePageQuery,
  buildSeriesOccurrencesPageQuery,
  createGroupEventSeries,
  getGroupEventSeries,
  inviteOccurrenceGuest,
  listOccurrenceAttendance,
  listOccurrenceGuests,
  liveEventResourceContextAccess,
  materializeSeriesOccurrences,
  updateGroupEventSeries,
} from "../functions/_lib/services/event-series";
import { buildGroupEventsPageQuery } from "../functions/_lib/services/events/group-read-model";
import { replaceEventTerms } from "../functions/_lib/services/events";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import { commitRegistrationSubmission } from "../functions/_lib/services/registration-submission";
import { grantResourceToGroup, revokeResourceGroupGrant } from "../functions/_lib/services/resource-grants";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertOrgRepresentative, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

interface Fixture {
  admin: UserBackedAuthAdmin;
  adminToken: string;
  ownerId: string;
  granteeId: string;
  outsiderId: string;
  eventId: string;
  eventSlug: string;
  seriesId: string;
  seriesUpdatedAt: string;
  memberId: string;
  memberEmail: string;
  memberToken: string;
  leader: UserBackedAuthAdmin;
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
    adminToken: await createAdminSession(env.DB, admin.id, `group-event-admin-${crypto.randomUUID()}`),
    ownerId: owner.id,
    granteeId: grantee.id,
    outsiderId: outsider.id,
    eventId: series.eventId,
    eventSlug: series.eventSlug,
    seriesId: series.id,
    seriesUpdatedAt: series.updatedAt,
    memberId: member.userId,
    memberEmail,
    memberToken: await createMemberSession(env.DB, member.userId, `group-event-member-${crypto.randomUUID()}`),
    leader,
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
    const occurrenceId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO event_occurrences
         (id, series_id, starts_at, ends_at, status, created_at, updated_at)
       VALUES (?, ?, '2027-01-10T10:00:00.000Z', '2027-01-10T11:00:00.000Z',
               'scheduled', datetime('now'), datetime('now'))`,
    )
      .bind(occurrenceId, fixture.seriesId)
      .run();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "register",
    });

    const occurrenceQuery = buildSeriesOccurrencesPageQuery(
      fixture.granteeId,
      liveEventResourceContextAccess({ userId: fixture.memberId }, fixture.granteeId),
      fixture.seriesId,
      eventOccurrencesListQuerySchema.parse({ status: "scheduled", limit: 20 }),
    );
    const occurrenceSql = buildOffsetPageSql(occurrenceQuery);
    const occurrencePlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${occurrenceSql.pageSql}`)
      .bind(...occurrenceSql.bindings, occurrenceQuery.limit, occurrenceQuery.offset)
      .all<{ detail: string }>();
    expect(occurrencePlan.results.map((row) => row.detail).join("\n")).toContain(
      "idx_event_occurrences_series_status_start",
    );

    const guestQuery = buildOccurrenceGuestsPageQuery(
      fixture.seriesId,
      occurrenceId,
      eventOccurrenceGuestsListQuerySchema.parse({ q: "guest", active: "true", limit: 20 }),
    );
    const guestSql = buildOffsetPageSql(guestQuery);
    const guestPlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${guestSql.pageSql}`)
      .bind(...guestSql.bindings, guestQuery.limit, guestQuery.offset)
      .all<{ detail: string }>();
    expect(guestPlan.results.map((row) => row.detail).join("\n")).toContain("idx_event_occurrence_guests_series");

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

    const seriesQuery = buildGroupEventSeriesPageQuery(
      fixture.granteeId,
      { member: true, manager: false },
      eventSeriesListQuerySchema.parse({ q: "architecture", profileKey: "workshop", limit: 20 }),
    );
    const seriesSql = buildOffsetPageSql(seriesQuery);
    const [seriesPagePlan, seriesCountPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${seriesSql.pageSql}`)
        .bind(...seriesSql.bindings, seriesQuery.limit, seriesQuery.offset)
        .all<{ detail: string }>(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${seriesSql.countSql}`)
        .bind(...seriesSql.countBindings)
        .all<{ detail: string }>(),
    ]);
    const seriesPlanText = [...seriesPagePlan.results, ...seriesCountPlan.results].map((row) => row.detail).join("\n");
    expect(seriesPlanText).toContain("idx_events_owner_profile");
    expect(seriesPlanText).toContain("idx_event_group_grants_group");

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

    const seriesPath = `/api/v1/groups/${fixture.granteeId}/meetings/series`;
    const anonymousSeries = await callApi(env, seriesPath);
    expect(anonymousSeries.status).toBe(401);

    const seriesList = await authenticatedRequest(
      fixture.memberToken,
      `${seriesPath}?q=architecture&profileKey=workshop&sort=event_name&limit=20`,
    );
    expect(seriesList.status, await seriesList.clone().text()).toBe(200);
    expect(await seriesList.json()).toMatchObject({
      series: [
        {
          id: fixture.seriesId,
          ownerGroupId: fixture.ownerId,
          profileKey: "workshop",
          capabilities: ["view", "register"],
        },
      ],
      page: { total: 1, hasMore: false },
    });

    const calendar = await authenticatedRequest(fixture.memberToken, `${seriesPath}/${fixture.seriesId}/calendar.ics`);
    expect(calendar.status, await calendar.clone().text()).toBe(200);
    expect(calendar.headers.get("content-type")).toContain("text/calendar");
    expect(await calendar.text()).toContain(`UID:${occurrenceId}@pkic.org`);

    const occurrences = await authenticatedRequest(
      fixture.memberToken,
      `${seriesPath}/${fixture.seriesId}/occurrences?status=scheduled&limit=20`,
    );
    expect(occurrences.status, await occurrences.clone().text()).toBe(200);
    expect(await occurrences.json()).toMatchObject({
      occurrences: [{ id: occurrenceId, seriesId: fixture.seriesId }],
      page: { total: 1, hasMore: false },
    });

    const wrongContext = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.outsiderId}/events/${fixture.eventId}`,
    );
    expect(wrongContext.status).toBe(404);
    const wrongSeriesContext = `/api/v1/groups/${fixture.outsiderId}/meetings/series`;
    const wrongSeriesList = await authenticatedRequest(fixture.memberToken, wrongSeriesContext);
    expect(wrongSeriesList.status).toBe(200);
    expect(await wrongSeriesList.json()).toMatchObject({ series: [], page: { total: 0 } });
    expect(
      (await authenticatedRequest(fixture.memberToken, `${wrongSeriesContext}/${fixture.seriesId}/calendar.ics`))
        .status,
    ).toBe(404);
    expect(
      (await authenticatedRequest(fixture.memberToken, `${wrongSeriesContext}/${fixture.seriesId}/occurrences`)).status,
    ).toBe(404);

    await revokeResourceGroupGrant(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "register",
    });
    const revoked = await authenticatedRequest(fixture.memberToken, `/api/v1/groups/${fixture.granteeId}/events`);
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ events: [], page: { total: 0 } });
    const revokedSeries = await authenticatedRequest(fixture.memberToken, seriesPath);
    expect(revokedSeries.status).toBe(200);
    expect(await revokedSeries.json()).toMatchObject({ series: [], page: { total: 0 } });
    expect(
      (await authenticatedRequest(fixture.memberToken, `${seriesPath}/${fixture.seriesId}/calendar.ics`)).status,
    ).toBe(404);
    expect(
      (await authenticatedRequest(fixture.memberToken, `${seriesPath}/${fixture.seriesId}/occurrences`)).status,
    ).toBe(404);
  });

  it("does not let participant filters reveal inactive series while managers can request them explicitly", async () => {
    const fixture = await createFixture();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "register",
    });
    await updateGroupEventSeries(env.DB, fixture.admin, fixture.ownerId, fixture.seriesId, {
      active: false,
      expectedUpdatedAt: fixture.seriesUpdatedAt,
    });

    const participantPath = `/api/v1/groups/${fixture.granteeId}/meetings/series?active=false`;
    const participant = await authenticatedRequest(fixture.memberToken, participantPath);
    expect(participant.status, await participant.clone().text()).toBe(200);
    expect(await participant.json()).toMatchObject({ series: [], page: { total: 0 } });

    const managerPath = `/api/v1/groups/${fixture.ownerId}/meetings/series?active=false`;
    const manager = await authenticatedRequest(fixture.adminToken, managerPath);
    expect(manager.status, await manager.clone().text()).toBe(200);
    expect(await manager.json()).toMatchObject({
      series: [{ id: fixture.seriesId, active: false }],
      page: { total: 1 },
    });
  });

  it("keeps attendance management separate from member participation", async () => {
    const fixture = await createFixture();
    const occurrenceId = crypto.randomUUID();
    const confirmationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_occurrences
           (id, series_id, starts_at, ends_at, status, created_at, updated_at)
         VALUES (?, ?, '2027-01-10T10:00:00.000Z', '2027-01-10T11:00:00.000Z',
                 'scheduled', datetime('now'), datetime('now'))`,
      ).bind(occurrenceId, fixture.seriesId),
      env.DB.prepare(
        `INSERT INTO event_occurrence_join_confirmations
           (id, occurrence_id, user_id, guest_id, name_snapshot, affiliation_snapshot,
            join_count, confirmed_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'Test Member', 'Example Organization', 1,
                 datetime('now'), datetime('now'), datetime('now'))`,
      ).bind(confirmationId, occurrenceId, fixture.memberId),
    ]);
    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage_attendance",
    });

    const memberList = await authenticatedRequest(fixture.memberToken, `/api/v1/groups/${fixture.granteeId}/events`);
    expect(memberList.status).toBe(200);
    expect(await memberList.json()).toMatchObject({ events: [], page: { total: 0 } });
    const memberSeries = await authenticatedRequest(
      fixture.memberToken,
      `/api/v1/groups/${fixture.granteeId}/meetings/series`,
    );
    expect(memberSeries.status).toBe(200);
    expect(await memberSeries.json()).toMatchObject({ series: [], page: { total: 0 } });

    const leaderList = await authenticatedRequest(fixture.leaderToken, `/api/v1/groups/${fixture.granteeId}/events`);
    expect(leaderList.status, await leaderList.clone().text()).toBe(200);
    expect(await leaderList.json()).toMatchObject({
      events: [{ id: fixture.eventId, capabilities: ["view", "manage_attendance"] }],
      page: { total: 1 },
    });
    const leaderSeries = await authenticatedRequest(
      fixture.leaderToken,
      `/api/v1/groups/${fixture.granteeId}/meetings/series`,
    );
    expect(leaderSeries.status, await leaderSeries.clone().text()).toBe(200);
    expect(await leaderSeries.json()).toMatchObject({
      series: [{ id: fixture.seriesId, capabilities: ["view", "manage_attendance"] }],
      page: { total: 1 },
    });

    const attendancePath = `/api/v1/groups/${fixture.granteeId}/meetings/series/${fixture.seriesId}/occurrences/${occurrenceId}/attendance`;
    const attendanceQuery = buildOccurrenceAttendancePageQuery(
      occurrenceId,
      eventAttendanceListQuerySchema.parse({ q: "example", verified: "false", limit: 20 }),
    );
    const attendanceSql = buildOffsetPageSql(attendanceQuery);
    const attendancePlan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${attendanceSql.pageSql}`)
      .bind(...attendanceSql.bindings, attendanceQuery.limit, attendanceQuery.offset)
      .all<{ detail: string }>();
    expect(attendancePlan.results.map((row) => row.detail).join("\n")).toContain("idx_event_occurrence_attendance");

    const memberAttendance = await authenticatedRequest(fixture.memberToken, attendancePath);
    expect(memberAttendance.status).toBe(401);

    const attendance = await authenticatedRequest(fixture.leaderToken, `${attendancePath}?q=example&verified=false`);
    expect(attendance.status, await attendance.clone().text()).toBe(200);
    expect(await attendance.json()).toMatchObject({
      confirmations: [{ id: confirmationId, attendanceVerifiedAt: null }],
      page: { total: 1 },
    });

    const verified = await authenticatedRequest(fixture.leaderToken, `${attendancePath}/${confirmationId}`, {
      method: "PUT",
      body: JSON.stringify({ source: "manual", note: "Verified by the delegated group lead" }),
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(await verified.json()).toMatchObject({
      confirmation: { id: confirmationId, attendanceVerificationSource: "manual" },
    });
    expect(
      await env.DB.prepare(
        `SELECT scope_type, scope_id FROM audit_log
          WHERE action = 'event_occurrence_attendance_verified' AND entity_id = ?`,
      )
        .bind(confirmationId)
        .first(),
    ).toEqual({ scope_type: "group", scope_id: fixture.granteeId });

    await env.DB.prepare(
      `CREATE TRIGGER test_event_attendance_zero_change
       BEFORE UPDATE ON event_occurrence_join_confirmations
       BEGIN
         SELECT RAISE(IGNORE);
       END`,
    ).run();
    const lostUpdate = await authenticatedRequest(fixture.leaderToken, `${attendancePath}/${confirmationId}`, {
      method: "PUT",
      body: JSON.stringify({ source: "manual", note: "This simulated update must not report success" }),
    });
    expect(lostUpdate.status).toBe(409);
    expect(await lostUpdate.json()).toMatchObject({ error: { code: "MEETING_JOIN_CONFIRMATION_CHANGED" } });
    await env.DB.prepare("DROP TRIGGER test_event_attendance_zero_change").run();
    expect(
      await env.DB.prepare(
        `SELECT COUNT(*) AS total FROM audit_log
          WHERE action = 'event_occurrence_attendance_verified' AND entity_id = ?`,
      )
        .bind(confirmationId)
        .first("total"),
    ).toBe(1);

    await revokeResourceGroupGrant(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage_attendance",
    });
    const revoked = await authenticatedRequest(fixture.leaderToken, attendancePath);
    expect(revoked.status).toBe(403);
    await expect(
      env.DB.prepare(
        `INSERT INTO event_resource_management_guards
           (id, event_id, group_id, required_capability, actor_user_id, trusted_service, created_at)
         VALUES (?, ?, ?, 'manage_attendance', ?, 0, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), fixture.eventId, fixture.granteeId, fixture.admin.id)
        .run(),
    ).rejects.toThrow("EVENT_RESOURCE_MANAGEMENT_CONTEXT_CHANGED");

    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage",
    });
    const impliedManagement = await authenticatedRequest(fixture.leaderToken, attendancePath);
    expect(impliedManagement.status, await impliedManagement.clone().text()).toBe(200);

    await expect(
      env.DB.prepare(
        `INSERT INTO event_resource_management_guards
           (id, event_id, group_id, required_capability, actor_user_id, trusted_service, created_at)
         VALUES (?, ?, ?, 'unknown_capability', ?, 0, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), fixture.eventId, fixture.granteeId, fixture.admin.id)
        .run(),
    ).rejects.toThrow("EVENT_RESOURCE_MANAGEMENT_CONTEXT_CHANGED");

    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(fixture.admin.id).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO event_resource_management_guards
           (id, event_id, group_id, required_capability, actor_user_id, trusted_service, created_at)
         VALUES (?, ?, ?, 'manage_attendance', ?, 0, datetime('now'))`,
      )
        .bind(crypto.randomUUID(), fixture.eventId, fixture.granteeId, fixture.admin.id)
        .run(),
    ).rejects.toThrow("EVENT_RESOURCE_MANAGEMENT_CONTEXT_CHANGED");
  });

  it("revalidates guest and attendance list authority in the same D1 batch as the page queries", async () => {
    const fixture = await createFixture();
    const occurrenceId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO event_occurrences
         (id, series_id, starts_at, ends_at, status, created_at, updated_at)
       VALUES (?, ?, '2027-01-10T10:00:00.000Z', '2027-01-10T11:00:00.000Z',
               'scheduled', datetime('now'), datetime('now'))`,
    )
      .bind(occurrenceId, fixture.seriesId)
      .run();
    await inviteOccurrenceGuest(
      env.DB,
      fixture.admin,
      fixture.ownerId,
      fixture.seriesId,
      occurrenceId,
      {
        email: `list-race-${crypto.randomUUID()}@example.test`,
        name: "List Race Guest",
        expiresAt: "2027-01-11T10:00:00.000Z",
      },
      "https://app.test",
    );
    await env.DB.prepare(
      `INSERT INTO event_occurrence_join_confirmations
         (id, occurrence_id, user_id, guest_id, name_snapshot, affiliation_snapshot,
          join_count, confirmed_at, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'List Race Member', 'Example Organization', 1,
               datetime('now'), datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), occurrenceId, fixture.memberId)
      .run();
    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage",
    });
    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage_attendance",
    });

    expect(
      (
        await listOccurrenceGuests(env.DB, fixture.leader, fixture.granteeId, fixture.seriesId, occurrenceId, {
          limit: 20,
          offset: 0,
        })
      ).total,
    ).toBe(1);
    const guestRaceDb = mutateBeforeNextBatch(env.DB, () =>
      revokeResourceGroupGrant(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
        granteeGroupId: fixture.granteeId,
        capability: "manage",
      }),
    );
    await expect(
      listOccurrenceGuests(guestRaceDb, fixture.leader, fixture.granteeId, fixture.seriesId, occurrenceId, {
        limit: 20,
        offset: 0,
      }),
    ).rejects.toMatchObject({ code: "EVENT_MANAGEMENT_CONTEXT_CHANGED" });

    expect(
      (
        await listOccurrenceAttendance(env.DB, fixture.leader, fixture.granteeId, fixture.seriesId, occurrenceId, {
          limit: 20,
          offset: 0,
        })
      ).total,
    ).toBe(1);
    const attendanceRaceDb = mutateBeforeNextBatch(env.DB, () =>
      revokeResourceGroupGrant(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
        granteeGroupId: fixture.granteeId,
        capability: "manage_attendance",
      }),
    );
    await expect(
      listOccurrenceAttendance(attendanceRaceDb, fixture.leader, fixture.granteeId, fixture.seriesId, occurrenceId, {
        limit: 20,
        offset: 0,
      }),
    ).rejects.toMatchObject({ code: "EVENT_ATTENDANCE_MANAGEMENT_CONTEXT_CHANGED" });
  });

  it("requires exact delegated event management and revalidates it atomically", async () => {
    const fixture = await createFixture();
    const occurrenceId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO event_occurrences
         (id, series_id, starts_at, ends_at, status, created_at, updated_at)
       VALUES (?, ?, '2027-01-10T10:00:00.000Z', '2027-01-10T11:00:00.000Z',
               'scheduled', datetime('now'), datetime('now'))`,
    )
      .bind(occurrenceId, fixture.seriesId)
      .run();
    const seriesPath = `/api/v1/groups/${fixture.granteeId}/meetings/series/${fixture.seriesId}`;
    const occurrencePath = `${seriesPath}/occurrences/${occurrenceId}`;

    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage_attendance",
    });
    const attendanceOnlyUpdate = await authenticatedRequest(fixture.leaderToken, seriesPath, {
      method: "PATCH",
      body: JSON.stringify({
        eventName: "Must not be changed by attendance management",
        expectedUpdatedAt: fixture.seriesUpdatedAt,
      }),
    });
    expect(attendanceOnlyUpdate.status).toBe(403);
    expect((await authenticatedRequest(fixture.leaderToken, `${occurrencePath}/guests`)).status).toBe(403);

    await revokeResourceGroupGrant(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage_attendance",
    });
    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage",
    });
    const managedUpdate = await authenticatedRequest(fixture.leaderToken, seriesPath, {
      method: "PATCH",
      body: JSON.stringify({
        eventName: "Delegated architecture workshop",
        expectedUpdatedAt: fixture.seriesUpdatedAt,
      }),
    });
    expect(managedUpdate.status, await managedUpdate.clone().text()).toBe(200);
    const managedSeries = (await managedUpdate.json<{ series: { updatedAt: string } }>()).series;
    const materialized = await authenticatedRequest(fixture.leaderToken, `${seriesPath}/materialize`, {
      method: "POST",
      body: JSON.stringify({ through: "2027-01-24T10:00:00.000Z", maxOccurrences: 10 }),
    });
    expect(materialized.status, await materialized.clone().text()).toBe(200);
    expect(await materialized.json()).toMatchObject({ created: 1, existing: 1 });

    const createdOccurrence = await authenticatedRequest(fixture.leaderToken, `${seriesPath}/occurrences`, {
      method: "POST",
      body: JSON.stringify({
        startsAt: "2099-02-01T10:00:00.000Z",
        endsAt: "2099-02-01T11:00:00.000Z",
      }),
    });
    expect(createdOccurrence.status, await createdOccurrence.clone().text()).toBe(201);
    const createdOccurrenceBody = await createdOccurrence.json<{ occurrence: { id: string; updatedAt: string } }>();
    const createdOccurrenceId = createdOccurrenceBody.occurrence.id;
    const createdOccurrencePath = `${seriesPath}/occurrences/${createdOccurrenceId}`;
    const occurrenceUpdate = await authenticatedRequest(fixture.leaderToken, createdOccurrencePath, {
      method: "PATCH",
      body: JSON.stringify({
        locationOverride: "Delegated room",
        expectedUpdatedAt: createdOccurrenceBody.occurrence.updatedAt,
      }),
    });
    expect(occurrenceUpdate.status, await occurrenceUpdate.clone().text()).toBe(200);

    const guestInvite = await authenticatedRequest(fixture.leaderToken, `${createdOccurrencePath}/guests`, {
      method: "POST",
      body: JSON.stringify({
        email: `delegated-guest-${crypto.randomUUID()}@example.test`,
        name: "Delegated Guest",
        expiresAt: "2099-02-01T12:00:00.000Z",
      }),
    });
    expect(guestInvite.status, await guestInvite.clone().text()).toBe(201);
    const guestId = (await guestInvite.json<{ guest: { id: string } }>()).guest.id;
    expect((await authenticatedRequest(fixture.leaderToken, `${createdOccurrencePath}/guests`)).status).toBe(200);
    const guestRevoke = await authenticatedRequest(fixture.leaderToken, `${createdOccurrencePath}/guests/${guestId}`, {
      method: "DELETE",
    });
    expect(guestRevoke.status, await guestRevoke.clone().text()).toBe(200);

    const scopedActions = await env.DB.prepare(
      `SELECT action, scope_id FROM audit_log
        WHERE scope_type = 'group' AND scope_id = ?
          AND action IN ('event_series_updated', 'event_occurrence_created', 'event_occurrence_updated',
                         'event_series_materialized', 'event_guest_invited',
                         'event_guest_revoked')
        ORDER BY action`,
    )
      .bind(fixture.granteeId)
      .all<{ action: string; scope_id: string }>();
    expect(scopedActions.results.map((row) => row.action)).toEqual([
      "event_guest_invited",
      "event_guest_revoked",
      "event_occurrence_created",
      "event_occurrence_updated",
      "event_series_materialized",
      "event_series_updated",
    ]);

    const wrongContext = await authenticatedRequest(
      fixture.leaderToken,
      `/api/v1/groups/${fixture.outsiderId}/meetings/series/${fixture.seriesId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ eventName: "Wrong context", expectedUpdatedAt: managedSeries.updatedAt }),
      },
    );
    expect(wrongContext.status).toBe(403);

    await revokeResourceGroupGrant(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage",
    });
    expect(
      (
        await authenticatedRequest(fixture.leaderToken, seriesPath, {
          method: "PATCH",
          body: JSON.stringify({ eventName: "Revoked context", expectedUpdatedAt: managedSeries.updatedAt }),
        })
      ).status,
    ).toBe(403);

    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage",
    });
    const racingGrantDb = mutateBeforeNextBatch(env.DB, () =>
      revokeResourceGroupGrant(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
        granteeGroupId: fixture.granteeId,
        capability: "manage",
      }),
    );
    await expect(
      updateGroupEventSeries(racingGrantDb, fixture.leader, fixture.granteeId, fixture.seriesId, {
        eventName: "Grant race must roll back",
        expectedUpdatedAt: (await getGroupEventSeries(env.DB, fixture.ownerId, fixture.seriesId)).updatedAt,
      }),
    ).rejects.toMatchObject({ code: "EVENT_MANAGEMENT_CONTEXT_CHANGED" });
    expect(await env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(fixture.eventId).first("name")).toBe(
      "Delegated architecture workshop",
    );

    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage",
    });
    const occurrenceCount = await env.DB.prepare("SELECT COUNT(*) AS total FROM event_occurrences WHERE series_id = ?")
      .bind(fixture.seriesId)
      .first<number>("total");
    const racingMaterializeDb = mutateBeforeNextBatch(env.DB, () =>
      revokeResourceGroupGrant(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
        granteeGroupId: fixture.granteeId,
        capability: "manage",
      }),
    );
    await expect(
      materializeSeriesOccurrences(racingMaterializeDb, fixture.leader, fixture.granteeId, fixture.seriesId, {
        through: "2027-01-24T10:00:00.000Z",
        maxOccurrences: 10,
      }),
    ).rejects.toMatchObject({ code: "EVENT_MANAGEMENT_CONTEXT_CHANGED" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM event_occurrences WHERE series_id = ?")
        .bind(fixture.seriesId)
        .first<number>("total"),
    ).toBe(occurrenceCount);

    await grantResourceToGroup(env.DB, fixture.admin, fixture.ownerId, "event", fixture.eventId, {
      granteeGroupId: fixture.granteeId,
      capability: "manage",
    });
    const racingLeadershipDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_roles SET revoked_at = datetime('now') WHERE user_id = ? AND context_id = ?")
        .bind(fixture.leader.id, fixture.granteeId)
        .run(),
    );
    await expect(
      updateGroupEventSeries(racingLeadershipDb, fixture.leader, fixture.granteeId, fixture.seriesId, {
        eventName: "Leadership race must roll back",
        expectedUpdatedAt: (await getGroupEventSeries(env.DB, fixture.ownerId, fixture.seriesId)).updatedAt,
      }),
    ).rejects.toMatchObject({ code: "EVENT_MANAGEMENT_CONTEXT_CHANGED" });
    expect(await env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(fixture.eventId).first("name")).toBe(
      "Delegated architecture workshop",
    );
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
