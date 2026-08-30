import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import {
  eventAudienceDetailSchema,
  eventDetailResponseSchema,
  eventManagementDetailResponseSchema,
  eventsAudienceListResponseSchema,
  eventsListQuerySchema,
  eventsListResponseSchema,
} from "../assets/shared/schemas/event-management";
import type { EventVisibility } from "../assets/shared/schemas/event-series";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { buildEventsPageQuery } from "../functions/_lib/services/events/catalog";
import { fetchViewerEventStates } from "../functions/_lib/services/events/viewer-state";
import { createGroup, joinGroup } from "../functions/_lib/services/groups";
import type { DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../functions/_lib/types";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { insertOrgRepresentative } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function request(path: string, token?: string): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    }),
    env,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

/** Parses the audience list projection directly so callers get typed `viewer`/`basePath` access. */
async function requestAudienceList(path: string, token?: string) {
  return eventsAudienceListResponseSchema.parse(await (await request(path, token)).json());
}

/** Parses the audience detail projection directly so callers get typed `viewer`/`basePath` access. */
async function requestAudienceDetail(path: string, token?: string) {
  const body = await (await request(path, token)).json();
  return eventAudienceDetailSchema.parse((body as { event: unknown }).event);
}

async function insertEvent(
  slug: string,
  visibility: EventVisibility,
  ownerGroupId: string | null = null,
  basePath: string | null = null,
) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events
       (id, slug, name, timezone, starts_at, ends_at, registration_mode, visibility,
        settings_json, links_json, owner_group_id, profile_key, source_mode, base_path, created_at, updated_at)
     VALUES (?, ?, ?, 'UTC', '2027-01-01T10:00:00.000Z', '2027-01-01T12:00:00.000Z',
             'optional', ?, ?, ?, ?, 'workshop', ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      slug,
      `${slug} event`,
      visibility,
      JSON.stringify({
        location: "Published room",
        virtualUrl: "https://secret.example.test/join",
        internal: "secret",
      }),
      JSON.stringify(["https://example.test/event"]),
      ownerGroupId,
      ownerGroupId ? "portal" : "integration",
      basePath,
    )
    .run();
  return id;
}

/** Registers `userId` on `eventId` and returns the new registration id. */
async function registerUserForEvent(
  eventId: string,
  userId: string,
  status: "pending_email_confirmation" | "registered" | "cancelled" = "registered",
) {
  const registrationId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO registrations
       (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'in_person', 'direct', ?, datetime('now'), datetime('now'))`,
  )
    .bind(registrationId, eventId, userId, status, `manage-${crypto.randomUUID()}`)
    .run();
  return registrationId;
}

/** Adds a configured event day and returns its id. */
async function insertEventDay(eventId: string, dayDate: string, sortOrder: number) {
  const dayId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event_days (id, event_id, day_date, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
  )
    .bind(dayId, eventId, dayDate, sortOrder)
    .run();
  return dayId;
}

/** Records that a registration selected a day, at `in_person` attendance. */
async function insertDayAttendance(registrationId: string, eventDayId: string) {
  await env.DB.prepare(
    `INSERT INTO registration_day_attendance (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
     VALUES (?, ?, ?, 'in_person', datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), registrationId, eventDayId)
    .run();
}

/** Creates an active (`waiting`) day-waitlist row for the registration on the given day. */
async function insertActiveDayWaitlistEntry(
  eventId: string,
  eventDayId: string,
  registrationId: string,
  userId: string,
) {
  await env.DB.prepare(
    `INSERT INTO event_day_waitlist_entries
       (id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'general', 'waiting', 1, datetime('now'), datetime('now'))`,
  )
    .bind(crypto.randomUUID(), eventId, eventDayId, registrationId, userId)
    .run();
}

describe("event audience visibility", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("filters rows in D1 and projects fields according to the caller's live audience", async () => {
    const adminUserId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'event-visibility-admin@example.test', 'event-visibility-admin@example.test', 'admin', 1,
               datetime('now'), datetime('now'))`,
    )
      .bind(adminUserId)
      .run();
    const admin: UserBackedAuthAdmin = {
      identityType: "user",
      id: adminUserId,
      email: "event-visibility-admin@example.test",
      role: "admin",
    };
    const group = await createGroup(env.DB, admin, {
      typeKey: "working_group",
      name: `Visibility group ${crypto.randomUUID()}`,
      visibility: "participants",
      eligibilityMode: "open",
    });
    const member = await insertOrgRepresentative(env.DB, {
      category: "A",
      email: `event-visibility-member-${crypto.randomUUID()}@example.test`,
    });
    const memberToken = await createMemberSession(env.DB, member.userId, `event-visibility-${crypto.randomUUID()}`);
    const publicEventId = await insertEvent("public-event", "public");
    await insertEvent("all-member-event", "all_members");
    await insertEvent("group-event", "group_members", group.id);
    const invitationEventId = await insertEvent("invitation-event", "invitation_only");

    const anonymousList = eventsListResponseSchema.parse(await (await request("/api/v1/events")).json());
    expect(anonymousList.events.map((event) => event.slug)).toEqual(["public-event"]);
    expect(anonymousList.page.total).toBe(1);

    const publicDetailResponse = await request("/api/v1/events/public-event");
    expect(publicDetailResponse.status).toBe(200);
    const publicDetail = eventDetailResponseSchema.parse(await publicDetailResponse.json()).event;
    expect(publicDetail).toMatchObject({ slug: "public-event", accessLevel: "public", visibility: "public" });
    expect(publicDetail).not.toHaveProperty("settings");
    expect(publicDetail).not.toHaveProperty("virtualUrl");
    expect(publicDetail).not.toHaveProperty("inviteLimitAttendee");
    expect(publicDetail).not.toHaveProperty("updatedAt");
    expect((await request("/api/v1/events/invitation-event")).status).toBe(404);

    const memberListBeforeJoin = eventsListResponseSchema.parse(
      await (await request("/api/v1/events", memberToken)).json(),
    );
    expect(memberListBeforeJoin.events.map((event) => event.slug).sort()).toEqual(["all-member-event", "public-event"]);

    await joinGroup(env.DB, group.id, {
      actorUserId: member.userId,
      targetUserId: member.userId,
      selection: { mode: "all_eligible", confirmed: true },
      source: "self_service",
      allowManaged: false,
    });
    const memberListAfterJoin = eventsListResponseSchema.parse(
      await (await request("/api/v1/events", memberToken)).json(),
    );
    expect(memberListAfterJoin.events.map((event) => event.slug).sort()).toEqual([
      "all-member-event",
      "group-event",
      "public-event",
    ]);

    await env.DB.prepare(
      `INSERT INTO invites
         (id, event_id, invitee_email, invite_type, link_secret, status, expires_at, created_at)
       SELECT ?, ?, normalized_email, 'attendee', ?, 'sent', '2027-01-01T10:00:00.000Z', datetime('now')
         FROM users WHERE id = ?`,
    )
      .bind(crypto.randomUUID(), invitationEventId, crypto.randomUUID(), member.userId)
      .run();
    const invitedList = eventsListResponseSchema.parse(await (await request("/api/v1/events", memberToken)).json());
    expect(invitedList.events.map((event) => event.slug).sort()).toEqual([
      "all-member-event",
      "group-event",
      "invitation-event",
      "public-event",
    ]);
    expect(invitedList.page.total).toBe(4);

    const adminToken = await createAdminSession(env.DB, adminUserId, `event-visibility-admin-${crypto.randomUUID()}`);
    const management = eventManagementDetailResponseSchema.parse(
      await (await request("/api/v1/events/public-event", adminToken)).json(),
    ).event;
    expect(management.id).toBe(publicEventId);
    expect(management.settings).toMatchObject({ internal: "secret" });
    expect(management.virtualUrl).toBe("https://secret.example.test/join");

    const visibilityUpdate = await app.fetch(
      new Request("https://app.test/api/v1/events/public-event/settings", {
        method: "PATCH",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: management.updatedAt, visibility: "invitation_only" }),
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(visibilityUpdate.status, await visibilityUpdate.clone().text()).toBe(200);
    expect(eventManagementDetailResponseSchema.parse(await visibilityUpdate.json()).event.visibility).toBe(
      "invitation_only",
    );
    expect((await request("/api/v1/events/public-event")).status).toBe(404);
    expect(
      eventsListResponseSchema.parse(await (await request("/api/v1/events")).json()).events.map((event) => event.slug),
    ).not.toContain("public-event");
  });

  it("does not downgrade an invalid credential to anonymous public access", async () => {
    await insertEvent("public-event", "public");
    const response = await request("/api/v1/events/public-event", "not-a-user-session");
    expect(response.status).toBe(401);
  });

  it("uses the visibility schedule index for anonymous page and count queries", async () => {
    const query = buildEventsPageQuery(
      { userId: null, canReadAll: false },
      eventsListQuerySchema.parse({ limit: 25, offset: 0 }),
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
    for (const plan of [pagePlan, countPlan]) {
      const details = plan.results.map((row) => row.detail).join("\n");
      expect(details).toContain("idx_events_visibility_schedule");
      expect(details).not.toContain("SCAN event");
    }
  });
});

describe("event audience viewer state", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("is null for an anonymous caller and does not run the enrichment query", async () => {
    await insertEvent("public-event", "public", null, "/events/public-event/");

    const list = await requestAudienceList("/api/v1/events");
    expect(list.events).toHaveLength(1);
    expect(list.events[0]).toMatchObject({ slug: "public-event", basePath: "/events/public-event/", viewer: null });

    const detail = await requestAudienceDetail("/api/v1/events/public-event");
    expect(detail).toMatchObject({ basePath: "/events/public-event/", viewer: null });

    let prepareCalls = 0;
    const underlyingDb = env.DB as unknown as DatabaseLike;
    const countingDb: DatabaseLike = {
      prepare(query: string): StatementLike {
        prepareCalls += 1;
        return underlyingDb.prepare(query);
      },
      batch: (statements) => underlyingDb.batch(statements),
    };
    const states = await fetchViewerEventStates(countingDb, null, ["some-event-id"]);
    expect(states.size).toBe(0);
    expect(prepareCalls).toBe(0);
  });

  it("is null for a signed-in caller with no registration on the event", async () => {
    const member = await insertOrgRepresentative(env.DB, { category: "A" });
    const memberToken = await createMemberSession(env.DB, member.userId, `viewer-none-${crypto.randomUUID()}`);
    await insertEvent("public-event", "public");

    const list = await requestAudienceList("/api/v1/events", memberToken);
    expect(list.events[0]).toMatchObject({ slug: "public-event", viewer: null });
  });

  it("reports the caller's own registration status, attendance type, and waitlist state", async () => {
    const member = await insertOrgRepresentative(env.DB, { category: "A" });
    const memberToken = await createMemberSession(env.DB, member.userId, `viewer-registered-${crypto.randomUUID()}`);
    const eventId = await insertEvent("registered-event", "invitation_only");
    await registerUserForEvent(eventId, member.userId, "registered");

    const list = await requestAudienceList("/api/v1/events", memberToken);
    const listEvent = list.events.find((event) => event.slug === "registered-event");
    expect(listEvent?.viewer).toEqual({
      registrationStatus: "registered",
      attendanceType: "in_person",
      waitlisted: false,
      days: [],
    });

    const detail = await requestAudienceDetail("/api/v1/events/registered-event", memberToken);
    expect(detail.viewer).toEqual({
      registrationStatus: "registered",
      attendanceType: "in_person",
      waitlisted: false,
      days: [],
    });
  });

  it("serializes a per-day breakdown of registered and actively waitlisted days", async () => {
    const member = await insertOrgRepresentative(env.DB, { category: "A" });
    const memberToken = await createMemberSession(env.DB, member.userId, `viewer-days-${crypto.randomUUID()}`);
    const eventId = await insertEvent("day-event", "invitation_only");
    const registrationId = await registerUserForEvent(eventId, member.userId, "registered");

    const dayOne = await insertEventDay(eventId, "2027-03-01", 0);
    const dayTwo = await insertEventDay(eventId, "2027-03-02", 1);
    const dayThree = await insertEventDay(eventId, "2027-03-03", 2);
    await insertDayAttendance(registrationId, dayOne);
    await insertDayAttendance(registrationId, dayTwo);
    await insertDayAttendance(registrationId, dayThree);
    // Only the middle day carries an active day-waitlist claim.
    await insertActiveDayWaitlistEntry(eventId, dayTwo, registrationId, member.userId);

    const detail = await requestAudienceDetail("/api/v1/events/day-event", memberToken);
    expect(detail.viewer).toEqual({
      registrationStatus: "registered",
      attendanceType: "in_person",
      waitlisted: true,
      days: [
        { date: "2027-03-01", state: "registered" },
        { date: "2027-03-02", state: "waitlisted" },
        { date: "2027-03-03", state: "registered" },
      ],
    });

    const list = await requestAudienceList("/api/v1/events", memberToken);
    const listEvent = list.events.find((event) => event.slug === "day-event");
    expect(listEvent?.viewer?.days).toEqual([
      { date: "2027-03-01", state: "registered" },
      { date: "2027-03-02", state: "waitlisted" },
      { date: "2027-03-03", state: "registered" },
    ]);
    expect(listEvent?.viewer?.waitlisted).toBe(true);
  });

  it("treats a cancelled registration as no standing on the event", async () => {
    const member = await insertOrgRepresentative(env.DB, { category: "A" });
    const memberToken = await createMemberSession(env.DB, member.userId, `viewer-cancelled-${crypto.randomUUID()}`);
    const eventId = await insertEvent("cancelled-event", "public");
    await registerUserForEvent(eventId, member.userId, "cancelled");

    const list = await requestAudienceList("/api/v1/events", memberToken);
    const listEvent = list.events.find((event) => event.slug === "cancelled-event");
    expect(listEvent?.viewer).toBeNull();

    const detail = await requestAudienceDetail("/api/v1/events/cancelled-event", memberToken);
    expect(detail.viewer).toBeNull();
  });
});
