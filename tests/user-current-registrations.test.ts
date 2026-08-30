import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { currentUserRegistrationsListResponseSchema } from "../assets/shared/schemas/current-user-registrations";
import {
  buildCurrentUserRegistrationsPageQuery,
  listCurrentUserRegistrations,
} from "../functions/_lib/services/registrations/current-user-read-model";
import { buildOffsetPageSql } from "../functions/_lib/db/pagination";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { insertIndividualMember, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function insertEvent(
  overrides: { slug?: string; name?: string; startsAt?: string; endsAt?: string; timezone?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'invite_or_open', 5, '{}', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(
      id,
      overrides.slug ?? `current-registrations-${crypto.randomUUID()}`,
      overrides.name ?? "A conference",
      overrides.timezone ?? "UTC",
      overrides.startsAt ?? "2027-06-01T08:00:00.000Z",
      overrides.endsAt ?? "2027-06-03T18:00:00.000Z",
    )
    .run();
  return id;
}

async function insertRegistration(
  eventId: string,
  userId: string,
  overrides: { status?: string; attendanceType?: string } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO registrations
       (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'self_service', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(
      id,
      eventId,
      userId,
      overrides.status ?? "registered",
      overrides.attendanceType ?? "in_person",
      crypto.randomUUID(),
    )
    .run();
  return id;
}

async function markActiveDayWaitlisted(eventId: string, registrationId: string, userId: string): Promise<void> {
  const dayId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO event_days (id, event_id, day_date, sort_order, created_at, updated_at)
     VALUES (?, ?, '2027-06-01', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(dayId, eventId)
    .run();
  await env.DB.prepare(
    `INSERT INTO event_day_waitlist_entries
       (id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'general', 'waiting', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  )
    .bind(crypto.randomUUID(), eventId, dayId, registrationId, userId)
    .run();
}

function getAs(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

beforeEach(resetDb);

describe("GET /api/v1/users/current/registrations", () => {
  it("rejects an unauthenticated caller", async () => {
    expect((await callApi(env, "/api/v1/users/current/registrations")).status).toBe(401);
  });

  it("allows a staff-only identity with no member capacity to read its own registrations", async () => {
    const staffOnlyUserId = await insertUser(env.DB, `current-registrations-staff-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(staffOnlyUserId).run();
    const eventId = await insertEvent();
    const registrationId = await insertRegistration(eventId, staffOnlyUserId);
    const token = await createMemberSession(
      env.DB,
      staffOnlyUserId,
      `current-registrations-staff-${crypto.randomUUID()}`,
    );

    const response = await getAs(token, "/api/v1/users/current/registrations");
    expect(response.status, await response.clone().text()).toBe(200);
    const page = currentUserRegistrationsListResponseSchema.parse(await response.json());
    expect(page.registrations.map((r) => r.id)).toEqual([registrationId]);
  });

  it("returns only the caller's own registrations, with waitlisted, pagination, and event-start ordering", async () => {
    const { userId } = await insertIndividualMember(
      env.DB,
      "H6",
      `current-registrations-user-${crypto.randomUUID()}@example.test`,
    );
    const otherUserId = await insertUser(env.DB, `current-registrations-other-${crypto.randomUUID()}@example.test`);
    const token = await createMemberSession(env.DB, userId, `current-registrations-${crypto.randomUUID()}`);

    const earlyEvent = await insertEvent({ startsAt: "2027-01-01T00:00:00.000Z", endsAt: "2027-01-02T00:00:00.000Z" });
    const lateEvent = await insertEvent({ startsAt: "2027-12-01T00:00:00.000Z", endsAt: "2027-12-02T00:00:00.000Z" });

    const earlyRegistration = await insertRegistration(earlyEvent, userId);
    const lateRegistration = await insertRegistration(lateEvent, userId, { attendanceType: "virtual" });
    await markActiveDayWaitlisted(lateEvent, lateRegistration, userId);
    // Belongs to a different user entirely — must never appear.
    await insertRegistration(earlyEvent, otherUserId);

    const response = await getAs(token, "/api/v1/users/current/registrations?limit=20&offset=0");
    expect(response.status, await response.clone().text()).toBe(200);
    const page = currentUserRegistrationsListResponseSchema.parse(await response.json());
    expect(page.registrations.map((r) => r.id)).toEqual([earlyRegistration, lateRegistration]);
    expect(page.page.total).toBe(2);

    const early = page.registrations.find((r) => r.id === earlyRegistration)!;
    expect(early.waitlisted).toBe(false);
    expect(early.attendanceType).toBe("in_person");
    expect(early.status).toBe("registered");
    expect(early.event.startsAt).toBe("2027-01-01T00:00:00.000Z");

    const late = page.registrations.find((r) => r.id === lateRegistration)!;
    expect(late.waitlisted).toBe(true);
    expect(late.attendanceType).toBe("virtual");

    // Parity: the route is a thin wrapper over the service, not a second policy.
    const direct = await listCurrentUserRegistrations(env.DB, userId, { limit: 20, offset: 0 });
    expect(new Set(direct.registrations.map((r) => r.id))).toEqual(new Set(page.registrations.map((r) => r.id)));
    expect(direct.total).toBe(page.page.total);

    // Bounded, deterministic pagination.
    const firstPage = currentUserRegistrationsListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/registrations?limit=1&offset=0")).json(),
    );
    expect(firstPage.registrations).toHaveLength(1);
    expect(firstPage.registrations[0]!.id).toBe(earlyRegistration);
    expect(firstPage.page).toMatchObject({ limit: 1, offset: 0, total: 2, hasMore: true });
    const secondPage = currentUserRegistrationsListResponseSchema.parse(
      await (await getAs(token, "/api/v1/users/current/registrations?limit=1&offset=1")).json(),
    );
    expect(secondPage.registrations[0]!.id).toBe(lateRegistration);
    expect(secondPage.page).toMatchObject({ limit: 1, offset: 1, total: 2, hasMore: false });
  });

  it("filters by from/to on the event's start time", async () => {
    const { userId } = await insertIndividualMember(
      env.DB,
      "H6",
      `current-registrations-range-${crypto.randomUUID()}@example.test`,
    );
    const token = await createMemberSession(env.DB, userId, `current-registrations-range-${crypto.randomUUID()}`);

    const early = await insertEvent({ startsAt: "2027-01-01T00:00:00.000Z" });
    const mid = await insertEvent({ startsAt: "2027-06-01T00:00:00.000Z" });
    const late = await insertEvent({ startsAt: "2027-12-01T00:00:00.000Z" });
    await insertRegistration(early, userId);
    const midRegistration = await insertRegistration(mid, userId);
    await insertRegistration(late, userId);

    const response = await getAs(
      token,
      "/api/v1/users/current/registrations?from=2027-03-01T00:00:00.000Z&to=2027-09-01T00:00:00.000Z",
    );
    const page = currentUserRegistrationsListResponseSchema.parse(await response.json());
    expect(page.registrations.map((r) => r.id)).toEqual([midRegistration]);
  });
});

describe("buildCurrentUserRegistrationsPageQuery D1 query plan", () => {
  beforeEach(resetDb);

  it("produces an executable EXPLAIN QUERY PLAN", async () => {
    const query = buildCurrentUserRegistrationsPageQuery("some-user-id", { limit: 50, offset: 0 });
    const { pageSql, countSql, bindings, countBindings } = buildOffsetPageSql(query);
    const [pagePlan, countPlan] = await Promise.all([
      env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`)
        .bind(...bindings, query.limit, query.offset)
        .all(),
      env.DB.prepare(`EXPLAIN QUERY PLAN ${countSql}`)
        .bind(...countBindings)
        .all(),
    ]);
    expect(pagePlan.results.length).toBeGreaterThan(0);
    expect(countPlan.results.length).toBeGreaterThan(0);
    // idx_registrations_user_event_status(user_id, event_id, status) — user_id-first, the closest
    // existing access path for this feed's WHERE r.user_id = ? filter.
    const planText = JSON.stringify(pagePlan.results);
    expect(planText).toContain("idx_registrations_user_event_status");
  });
});
