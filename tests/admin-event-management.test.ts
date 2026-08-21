import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  createRegistration,
  confirmRegistrationByToken,
  updateRegistrationById,
} from "../functions/_lib/services/registrations";
import { adminRegistrationDetailResponseSchema } from "../assets/shared/schemas/admin-registration-detail";

let ADMIN_TOKEN = "event-admin-token";

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(`https://app.test${path}`, {
    ...init,
    headers,
  });
}

async function callAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    adminRequest(path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function setupAdmin(): Promise<{ baseEventId: string }> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminRow = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0];
  ADMIN_TOKEN = await createAdminSession(env.DB, adminRow.id, ADMIN_TOKEN);
  return { baseEventId: eventId };
}

describe("admin event management endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists events and creates a new event", async () => {
    await setupAdmin();

    const createResponse = await callAdmin("/api/v1/admin/events", {
      method: "POST",
      body: JSON.stringify({
        slug: "pqc-2027",
        name: "PQC 2027",
        timezone: "Europe/Amsterdam",
        startsAt: "2027-04-12T08:00:00.000Z",
        endsAt: "2027-04-14T17:00:00.000Z",
        registrationMode: "open",
        inviteLimitAttendee: 10,
        venue: "Amsterdam Congress Center",
        virtualUrl: "https://pkic.org/live/",
      }),
    });

    expect(createResponse.status).toBe(201);
    const createdPayload = (await createResponse.json()) as {
      event: { slug: string; settings: Record<string, unknown> };
    };
    expect(createdPayload.event.slug).toBe("pqc-2027");
    expect(createdPayload.event.settings.venue).toBe("Amsterdam Congress Center");

    const duplicateResponse = await callAdmin("/api/v1/admin/events", {
      method: "POST",
      body: JSON.stringify({
        slug: "pqc-2027",
        name: "PQC 2027 Duplicate",
        timezone: "Europe/Amsterdam",
        registrationMode: "open",
        inviteLimitAttendee: 10,
      }),
    });

    expect(duplicateResponse.status).toBe(409);
    const duplicatePayload = (await duplicateResponse.json()) as { error?: { code?: string } };
    expect(duplicatePayload.error?.code).toBe("SLUG_TAKEN");

    const listResponse = await callAdmin("/api/v1/admin/events");
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as {
      events: Array<{ slug: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(listPayload.events.map((event) => event.slug)).toEqual(expect.arrayContaining(["pqc-2026", "pqc-2027"]));
    expect(listPayload.page.total).toBeGreaterThanOrEqual(2);
  });

  it("P6M-P2-04: bounds the events list with ?limit=/?offset= via the query schema (data.query, not a fetch-everything scan)", async () => {
    await setupAdmin();
    await callAdmin("/api/v1/admin/events", {
      method: "POST",
      body: JSON.stringify({ slug: "bounded-a", name: "Bounded A", timezone: "UTC" }),
    });
    await callAdmin("/api/v1/admin/events", {
      method: "POST",
      body: JSON.stringify({ slug: "bounded-b", name: "Bounded B", timezone: "UTC" }),
    });

    const firstPage = await callAdmin("/api/v1/admin/events?limit=1&offset=0");
    expect(firstPage.status).toBe(200);
    const firstBody = (await firstPage.json()) as {
      events: unknown[];
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(firstBody.events).toHaveLength(1);
    expect(firstBody.page.limit).toBe(1);
    expect(firstBody.page.hasMore).toBe(true);
    expect(firstBody.page.total).toBeGreaterThanOrEqual(3);

    const searched = await callAdmin("/api/v1/admin/events?q=bounded-b");
    const searchedBody = (await searched.json()) as { events: Array<{ slug: string }>; page: { total: number } };
    expect(searchedBody.events.map(({ slug }) => slug)).toEqual(["bounded-b"]);
    expect(searchedBody.page.total).toBe(1);

    const invalidLimit = await callAdmin("/api/v1/admin/events?limit=0");
    expect(invalidLimit.status).toBe(400);
  });

  it("returns details and persists settings updates", async () => {
    await setupAdmin();

    const detailResponse = await callAdmin("/api/v1/admin/events/pqc-2026");
    expect(detailResponse.status).toBe(200);
    const detailPayload = (await detailResponse.json()) as {
      event: { slug: string; settings: Record<string, unknown> };
    };
    expect(detailPayload.event.slug).toBe("pqc-2026");

    const patchResponse = await callAdmin("/api/v1/admin/events/pqc-2026/settings", {
      method: "PATCH",
      body: JSON.stringify({
        name: "PQC Conference 2026 - Updated",
        venue: "The Hague Conference Center",
        virtualUrl: "https://pkic.org/live/pqc-2026/",
        userRetentionDays: 180,
        sessionTypes: [
          { label: "talk", requiresPresentation: true },
          { label: "panel", requiresPresentation: false },
        ],
        registrationFormKey: "pqc-reg-form",
        proposalFormKey: null,
      }),
    });

    expect(patchResponse.status).toBe(200);
    const patchPayload = (await patchResponse.json()) as {
      success: boolean;
      event: {
        name: string;
        venue: string | null;
        user_retention_days: number | null;
        settings: Record<string, unknown>;
      };
    };
    expect(patchPayload.success).toBe(true);
    expect(patchPayload.event.name).toBe("PQC Conference 2026 - Updated");
    expect(patchPayload.event.settings.venue).toBe("The Hague Conference Center");
    expect(patchPayload.event.settings.virtualUrl).toBe("https://pkic.org/live/pqc-2026/");
    expect(patchPayload.event.user_retention_days).toBe(180);
    expect(
      (
        patchPayload.event.settings.proposal as
          { sessionTypes?: { label: string; requiresPresentation: boolean }[] } | undefined
      )?.sessionTypes,
    ).toEqual([
      { label: "talk", requiresPresentation: true },
      { label: "panel", requiresPresentation: false },
    ]);
    expect(
      patchPayload.event.settings.forms as
        { event_registration?: string | null; proposal_submission?: string | null } | undefined,
    ).toEqual({
      event_registration: "pqc-reg-form",
      proposal_submission: null,
    });
  });

  it("replaces event days and exposes permission grants", async () => {
    await setupAdmin();

    const daysResponse = await callAdmin("/api/v1/admin/events/pqc-2026/days", {
      method: "PUT",
      body: JSON.stringify({
        days: [
          {
            date: "2026-12-01",
            label: "Day 1",
            startTime: "09:00",
            endTime: "17:00",
            sortOrder: 0,
            attendanceOptions: [
              { value: "in_person", label: "In person", capacity: 30 },
              { value: "virtual", label: "Virtual" },
            ],
          },
          {
            date: "2026-12-02",
            label: "Day 2",
            startTime: "10:00",
            endTime: "16:00",
            sortOrder: 1,
            attendanceOptions: [{ value: "in_person", label: "In person", capacity: 20 }],
          },
        ],
      }),
    });

    expect(daysResponse.status).toBe(200);
    const daysPayload = (await daysResponse.json()) as {
      success: boolean;
      days: Array<{ date: string; label: string }>;
    };
    expect(daysPayload.success).toBe(true);
    expect(daysPayload.days.map((day) => day.date)).toEqual(["2026-12-01", "2026-12-02"]);

    const invalidRange = await callAdmin("/api/v1/admin/events/pqc-2026/days", {
      method: "PUT",
      body: JSON.stringify({
        days: [
          {
            date: "2026-12-03",
            startTime: "17:00",
            endTime: "09:00",
            attendanceOptions: [{ value: "virtual", label: "Virtual" }],
          },
        ],
      }),
    });
    expect(invalidRange.status).toBe(400);
    const preservedDays = (await (await callAdmin("/api/v1/admin/events/pqc-2026/days")).json()) as {
      days: Array<{ date: string }>;
    };
    expect(preservedDays.days.map((day) => day.date)).toEqual(["2026-12-01", "2026-12-02"]);

    const duplicateDates = await callAdmin("/api/v1/admin/events/pqc-2026/days", {
      method: "PUT",
      body: JSON.stringify({
        days: [
          { date: "2026-12-01", attendanceOptions: [] },
          { date: "2026-12-01", attendanceOptions: [] },
        ],
      }),
    });
    expect(duplicateDates.status).toBe(400);

    const permissionResponse = await callAdmin("/api/v1/admin/events/pqc-2026/permissions", {
      method: "POST",
      body: JSON.stringify({
        userEmail: "organizer@example.test",
        permission: "organizer",
      }),
    });

    expect(permissionResponse.status).toBe(201);
    const permissionPayload = (await permissionResponse.json()) as {
      permission: { user_email: string; permission: string };
    };
    expect(permissionPayload.permission.user_email).toBe("organizer@example.test");
    expect(permissionPayload.permission.permission).toBe("organizer");

    const duplicatePermissionResponse = await callAdmin("/api/v1/admin/events/pqc-2026/permissions", {
      method: "POST",
      body: JSON.stringify({
        userEmail: "organizer@example.test",
        permission: "organizer",
      }),
    });

    expect(duplicatePermissionResponse.status).toBe(409);

    const permissionListResponse = await callAdmin("/api/v1/admin/events/pqc-2026/permissions");
    expect(permissionListResponse.status).toBe(200);
    const permissionListPayload = (await permissionListResponse.json()) as {
      permissions: Array<{ user_email: string; permission: string }>;
    };
    expect(permissionListPayload.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_email: "organizer@example.test", permission: "organizer" }),
      ]),
    );
  });

  it("atomically replaces event terms and rejects duplicate audience term versions", async () => {
    const { baseEventId } = await setupAdmin();
    const replacement = {
      attendee: [
        {
          termKey: "privacy-policy",
          version: "v2",
          required: true,
          displayText: "I accept the privacy policy.",
        },
      ],
      speaker: [],
      presentation: [],
    };
    const response = await callAdmin("/api/v1/admin/events/pqc-2026/terms", {
      method: "PUT",
      body: JSON.stringify(replacement),
    });
    expect(response.status).toBe(200);
    expect(
      await queryAll<{ term_key: string; version: string }>(
        env.DB,
        "SELECT term_key, version FROM event_terms WHERE event_id = ? AND active = 1 ORDER BY term_key",
        [baseEventId],
      ),
    ).toEqual([{ term_key: "privacy-policy", version: "v2" }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE entity_type = 'event' AND entity_id = ? AND action = 'event_terms_replaced'",
        [baseEventId],
      ),
    ).toHaveLength(1);

    const duplicate = await callAdmin("/api/v1/admin/events/pqc-2026/terms", {
      method: "PUT",
      body: JSON.stringify({
        ...replacement,
        attendee: [replacement.attendee[0], replacement.attendee[0]],
      }),
    });
    expect(duplicate.status).toBe(400);
    expect(
      await queryAll<{ term_key: string; version: string }>(
        env.DB,
        "SELECT term_key, version FROM event_terms WHERE event_id = ? AND active = 1",
        [baseEventId],
      ),
    ).toEqual([{ term_key: "privacy-policy", version: "v2" }]);
  });

  it("P6M-P2-06: searches, bounds, and sorts the event-team permissions list", async () => {
    await setupAdmin();

    for (const [email, permission] of [
      ["p1@example.test", "organizer"],
      ["p2@example.test", "moderator"],
      ["p3@example.test", "volunteer"],
    ] as const) {
      const res = await callAdmin("/api/v1/admin/events/pqc-2026/permissions", {
        method: "POST",
        body: JSON.stringify({ userEmail: email, permission }),
      });
      expect(res.status).toBe(201);
    }

    const firstPage = await callAdmin("/api/v1/admin/events/pqc-2026/permissions?limit=2&offset=0");
    expect(firstPage.status).toBe(200);
    const firstBody = (await firstPage.json()) as {
      permissions: unknown[];
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };
    expect(firstBody.permissions).toHaveLength(2);
    expect(firstBody.page).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true });

    const searched = await callAdmin("/api/v1/admin/events/pqc-2026/permissions?q=p2%40example.test");
    const searchedBody = (await searched.json()) as {
      permissions: Array<{ user_email: string }>;
      page: { total: number };
    };
    expect(searchedBody.permissions.map(({ user_email }) => user_email)).toEqual(["p2@example.test"]);
    expect(searchedBody.page.total).toBe(1);

    const sorted = await callAdmin("/api/v1/admin/events/pqc-2026/permissions?sort=created_at");
    expect(sorted.status).toBe(200);

    const invalidLimit = await callAdmin("/api/v1/admin/events/pqc-2026/permissions?limit=0");
    expect(invalidLimit.status).toBe(400);
  });

  it("allows admin to reinstate a cancelled registration and rejects double-cancel", async () => {
    await setupAdmin();

    const userId = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
       VALUES (?, 'reinstate@example.test', 'reinstate@example.test', datetime('now'), datetime('now'))`,
    )
      .bind(userId)
      .run();

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistration(env.DB, {
      event,
      userId,
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: created.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    // Cancel via the service (simulates attendee or earlier admin action)
    const cancelled = await updateRegistrationById(
      env.DB,
      { registrationId: created.registration.id, action: "cancel", waitlistClaimWindowHours: 24 },
      "admin:test",
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled_at).not.toBeNull();

    const detailResponse = await callAdmin(`/api/v1/admin/events/pqc-2026/registrations/${created.registration.id}`);
    expect(detailResponse.status).toBe(200);
    const rawDetail = await detailResponse.json();
    const detail = adminRegistrationDetailResponseSchema.parse(rawDetail);
    expect(detail.registration.status).toBe("cancelled");
    expect(rawDetail).not.toHaveProperty("registration.custom_answers_json");
    expect(rawDetail).not.toHaveProperty("registration.manage_link_secret");

    // Double-cancel must still be rejected
    await expect(
      updateRegistrationById(
        env.DB,
        { registrationId: created.registration.id, action: "cancel", waitlistClaimWindowHours: 24 },
        "admin:test",
      ),
    ).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });

    // Admin reinstates via the HTTP endpoint
    const reinstateResponse = await callAdmin(
      `/api/v1/admin/events/pqc-2026/registrations/${created.registration.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "update", attendanceType: "virtual" }),
      },
    );
    expect(reinstateResponse.status).toBe(200);
    const reinstatePayload = (await reinstateResponse.json()) as { success: boolean; registration: { status: string } };
    expect(reinstatePayload.success).toBe(true);
    expect(reinstatePayload.registration.status).toBe("registered");

    const row = (
      await queryAll<{ cancelled_at: string | null }>(
        env.DB,
        "SELECT cancelled_at FROM registrations WHERE id = ?",
        created.registration.id,
      )
    )[0];
    expect(row.cancelled_at).toBeNull();
  });

  it("separates accepted attendees from active day waitlists in both event statistics views", async () => {
    const { baseEventId } = await setupAdmin();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('statistics-day-1', '${baseEventId}', '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('statistics-accepted', 'accepted@example.test', 'accepted@example.test', 'Accepted', 'Attendee', datetime('now'), datetime('now')),
          ('statistics-waitlisted', 'waitlisted@example.test', 'waitlisted@example.test', 'Waitlisted', 'Attendee', datetime('now'), datetime('now')),
          ('statistics-virtual', 'virtual@example.test', 'virtual@example.test', 'Virtual', 'Attendee', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const accepted = await createRegistration(env.DB, {
      event,
      userId: "statistics-accepted",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: accepted.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const waitlisted = await createRegistration(env.DB, {
      event,
      userId: "statistics-waitlisted",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: waitlisted.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const virtual = await createRegistration(env.DB, {
      event,
      userId: "statistics-virtual",
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: virtual.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const overviewResponse = await callAdmin("/api/v1/admin/events/pqc-2026/registrations");
    expect(overviewResponse.status).toBe(200);
    const overview = (await overviewResponse.json()) as {
      stats: {
        byAttendanceType: Record<string, number>;
        attendanceStatusByType: Record<string, { accepted: number; waitlisted: number }>;
      };
    };
    expect(overview.stats.byAttendanceType).toMatchObject({ in_person: 2, virtual: 1 });
    expect(overview.stats.attendanceStatusByType).toMatchObject({
      in_person: { accepted: 1, waitlisted: 1 },
      virtual: { accepted: 1, waitlisted: 0 },
    });

    const statsResponse = await callAdmin("/api/v1/admin/events/pqc-2026/stats");
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as {
      registrations: {
        attendanceStatusByType: Record<string, { accepted: number; waitlisted: number }>;
      };
      registrationsByEventDay: Array<{ attendance_type: string; attendance_status: string; count: number }>;
    };
    expect(stats.registrations.attendanceStatusByType).toEqual(overview.stats.attendanceStatusByType);
    expect(stats.registrationsByEventDay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ attendance_type: "in_person", attendance_status: "accepted", count: 1 }),
        expect.objectContaining({ attendance_type: "in_person", attendance_status: "waitlisted", count: 1 }),
      ]),
    );

    const platformStatsResponse = await callAdmin("/api/v1/admin/stats");
    expect(platformStatsResponse.status).toBe(200);
    const platformStats = (await platformStatsResponse.json()) as {
      topEvents: Array<{ slug: string; confirmed: number; total: number }>;
    };
    expect(platformStats.topEvents).toContainEqual(
      expect.objectContaining({ slug: "pqc-2026", confirmed: 3, total: 3 }),
    );
  });

  it("preserves system history when a cancelled registration is reactivated", async () => {
    const { baseEventId } = await setupAdmin();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('reactivation-day', '${baseEventId}', '2026-12-01', 'Day 1', 10, 0, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES ('reactivation-attendee', 'reactivation@example.test', 'reactivation@example.test',
                'Reactivated', 'Attendee', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const original = await createRegistration(env.DB, {
      event,
      userId: "reactivation-attendee",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare("UPDATE registrations SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?")
      .bind(original.registration.id)
      .run();

    const reactivated = await createRegistration(env.DB, {
      event,
      userId: "reactivation-attendee",
      attendanceType: "virtual",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    expect(reactivated.reactivated).toBe(true);
    expect(reactivated.registration.id).toBe(original.registration.id);
    const history = await queryAll<{ from_type: string; to_type: string; changed_by: string }>(
      env.DB,
      `SELECT from_type, to_type, changed_by
       FROM registration_attendance_history
       WHERE registration_id = ?`,
      [original.registration.id],
    );
    expect(history).toEqual([{ from_type: "in_person", to_type: "virtual", changed_by: "system" }]);

    const statsResponse = await callAdmin("/api/v1/admin/events/pqc-2026/stats");
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as {
      attendanceChanges: { changedAttendees: number; dayChanges: number };
    };
    expect(stats.attendanceChanges).toMatchObject({ changedAttendees: 0, dayChanges: 0 });
  });

  it("counts nullable legacy history as a move into in-person attendance", async () => {
    const { baseEventId } = await setupAdmin();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('legacy-movement-day', '${baseEventId}', '2026-12-01', 'Day 1', 10, 0, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES ('legacy-movement-attendee', 'legacy-movement@example.test', 'legacy-movement@example.test',
                'Legacy', 'Movement', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistration(env.DB, {
      event,
      userId: "legacy-movement-attendee",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare(
      `INSERT INTO registration_attendance_history (
         id, registration_id, event_day_id, from_type, to_type, changed_by, changed_at
       ) VALUES ('legacy-null-transition', ?, 'legacy-movement-day', NULL, 'in_person', 'admin:test', datetime('now'))`,
    )
      .bind(created.registration.id)
      .run();

    const statsResponse = await callAdmin("/api/v1/admin/events/pqc-2026/stats");
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as {
      attendanceChanges: {
        changedAttendees: number;
        joinedInPersonAttendees: number;
        joinedInPersonDayChanges: number;
        byTransition: Array<{ from_type: string; to_type: string; attendees: number }>;
      };
    };
    expect(stats.attendanceChanges).toMatchObject({
      changedAttendees: 1,
      joinedInPersonAttendees: 1,
      joinedInPersonDayChanges: 1,
    });
    expect(stats.attendanceChanges.byTransition).toContainEqual({
      from_type: "not_attending",
      to_type: "in_person",
      attendees: 1,
      day_changes: 1,
    });

    const joinedResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?attendance_change=joined_in_person",
    );
    expect(joinedResponse.status).toBe(200);
    const joined = (await joinedResponse.json()) as { registrations: Array<{ id: string }>; page: { total: number } };
    expect(joined.page.total).toBe(1);
    expect(joined.registrations[0]?.id).toBe(created.registration.id);
  });

  it("counts multi-day attendance movement once per attendee and separately per day", async () => {
    const { baseEventId } = await setupAdmin();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES
          ('movement-day-1', '${baseEventId}', '2026-12-01', 'Day 1', 10, 0, datetime('now'), datetime('now')),
          ('movement-day-2', '${baseEventId}', '2026-12-02', 'Day 2', 10, 1, datetime('now'), datetime('now')),
          ('movement-day-3', '${baseEventId}', '2026-12-03', 'Day 3', 10, 2, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES ('movement-attendee', 'movement@example.test', 'movement@example.test', 'Movement', 'Attendee', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const dayAttendance = ["01", "02", "03"].map((day) => ({
      dayDate: `2026-12-${day}`,
      attendanceType: "in_person" as const,
    }));
    const created = await createRegistration(env.DB, {
      event,
      userId: "movement-attendee",
      attendanceType: "in_person",
      dayAttendance,
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: created.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const initialStatsResponse = await callAdmin("/api/v1/admin/events/pqc-2026/stats");
    expect(initialStatsResponse.status).toBe(200);
    const initialStats = (await initialStatsResponse.json()) as {
      attendanceChanges: { changedAttendees: number; dayChanges: number };
    };
    expect(initialStats.attendanceChanges).toMatchObject({ changedAttendees: 0, dayChanges: 0 });

    await updateRegistrationById(
      env.DB,
      {
        registrationId: created.registration.id,
        action: "update",
        attendanceType: "virtual",
        dayAttendance: dayAttendance.map((entry) => ({ ...entry, attendanceType: "virtual" as const })),
        waitlistClaimWindowHours: 24,
      },
      "admin:test",
    );

    const statsResponse = await callAdmin("/api/v1/admin/events/pqc-2026/stats");
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as {
      attendanceChanges: {
        changedAttendees: number;
        dayChanges: number;
        leftInPersonAttendees: number;
        leftInPersonDayChanges: number;
        joinedInPersonAttendees: number;
        byTransition: Array<{ from_type: string; to_type: string; attendees: number; day_changes: number }>;
        byDay: Array<{
          day_date: string;
          changed_attendees: number;
          left_in_person_attendees: number;
          day_changes: number;
        }>;
        recent: Array<{ registration_id: string; days: Array<{ day_date: string }> }>;
      };
    };

    expect(stats.attendanceChanges).toMatchObject({
      changedAttendees: 1,
      dayChanges: 3,
      leftInPersonAttendees: 1,
      leftInPersonDayChanges: 3,
      joinedInPersonAttendees: 0,
    });
    expect(stats.attendanceChanges.byTransition).toEqual([
      { from_type: "in_person", to_type: "virtual", attendees: 1, day_changes: 3 },
    ]);
    expect(stats.attendanceChanges.byDay).toHaveLength(3);
    expect(stats.attendanceChanges.byDay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          day_date: "2026-12-01",
          changed_attendees: 1,
          left_in_person_attendees: 1,
          day_changes: 1,
        }),
      ]),
    );
    expect(stats.attendanceChanges.recent).toHaveLength(1);
    expect(stats.attendanceChanges.recent[0]).toMatchObject({ registration_id: created.registration.id });
    expect(stats.attendanceChanges.recent[0].days).toHaveLength(3);

    const leftInPersonResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?attendance_change=left_in_person",
    );
    expect(leftInPersonResponse.status).toBe(200);
    const leftInPerson = (await leftInPersonResponse.json()) as {
      registrations: Array<{
        id: string;
        lastAttendanceChange: {
          changedAt: string;
          transitions: Array<{
            fromType: string;
            toType: string;
            days: Array<{ dayDate: string }>;
          }>;
        };
      }>;
      page: { total: number };
    };
    expect(leftInPerson.page.total).toBe(1);
    expect(leftInPerson.registrations[0]).toMatchObject({ id: created.registration.id });
    expect(leftInPerson.registrations[0].lastAttendanceChange.transitions).toEqual([
      expect.objectContaining({ fromType: "in_person", toType: "virtual" }),
    ]);
    expect(leftInPerson.registrations[0].lastAttendanceChange.transitions[0].days).toHaveLength(3);

    const joinedInPersonResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?attendance_change=joined_in_person",
    );
    const joinedInPerson = (await joinedInPersonResponse.json()) as { page: { total: number } };
    expect(joinedInPerson.page.total).toBe(0);

    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES ('movement-later', 'movement-later@example.test', 'movement-later@example.test',
               'Later', 'Movement', datetime('now'), datetime('now'))`,
    ).run();
    const later = await createRegistration(env.DB, {
      event,
      userId: "movement-later",
      attendanceType: "in_person",
      dayAttendance,
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare(
      "UPDATE registration_attendance_history SET changed_at = '2025-01-01T00:00:00.000Z' WHERE registration_id = ?",
    )
      .bind(created.registration.id)
      .run();
    await updateRegistrationById(
      env.DB,
      {
        registrationId: later.registration.id,
        action: "update",
        attendanceType: "virtual",
        dayAttendance: dayAttendance.map((entry) => ({ ...entry, attendanceType: "virtual" as const })),
        waitlistClaimWindowHours: 24,
      },
      "admin:test",
    );
    await updateRegistrationById(
      env.DB,
      {
        registrationId: created.registration.id,
        action: "update",
        attendanceType: "on_demand",
        dayAttendance: dayAttendance.map((entry) => ({ ...entry, attendanceType: "on_demand" as const })),
        waitlistClaimWindowHours: 24,
      },
      "admin:test",
    );
    await env.DB.prepare(
      `UPDATE registration_attendance_history
       SET changed_at = '2030-01-01T00:00:00.000Z'
       WHERE registration_id = ? AND from_type = 'virtual' AND to_type = 'on_demand'`,
    )
      .bind(created.registration.id)
      .run();

    const recentlyChangedResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?attendance_change=any",
    );
    const recentlyChanged = (await recentlyChangedResponse.json()) as {
      registrations: Array<{
        id: string;
        attendanceChangeHistory: Array<{
          changedAt: string;
          transitions: Array<{ fromType: string; toType: string }>;
        }>;
        lastAttendanceChange: { changedAt: string };
      }>;
      page: { total: number };
    };
    expect(recentlyChanged.page.total).toBe(2);
    expect(recentlyChanged.registrations.map((registration) => registration.id)).toEqual([
      created.registration.id,
      later.registration.id,
    ]);
    expect(recentlyChanged.registrations[0].attendanceChangeHistory).toHaveLength(2);
    expect(
      recentlyChanged.registrations[0].attendanceChangeHistory.map((change) =>
        change.transitions.map((transition) => `${transition.fromType}->${transition.toType}`),
      ),
    ).toEqual([["in_person->virtual"], ["virtual->on_demand"]]);
    expect(recentlyChanged.registrations[0].lastAttendanceChange.changedAt).toBe("2030-01-01T00:00:00.000Z");

    const invalidFilterResponse = await callAdmin(
      "/api/v1/admin/events/pqc-2026/registrations?attendance_change=unexpected",
    );
    expect(invalidFilterResponse.status).toBe(400);
    const invalidFilter = (await invalidFilterResponse.json()) as { error: { code: string } };
    expect(invalidFilter.error.code).toBe("VALIDATION_ERROR");
  });

  it("bounds the registrations list via limit/offset with a real COUNT-based hasMore, not a limit+1 slice", async () => {
    await setupAdmin();
    const event = await getEventBySlug(env.DB, "pqc-2026");

    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
       VALUES
         ('bounded-a', 'bounded-a@example.test', 'bounded-a@example.test', 'A', 'Attendee', datetime('now'), datetime('now')),
         ('bounded-b', 'bounded-b@example.test', 'bounded-b@example.test', 'B', 'Attendee', datetime('now'), datetime('now')),
         ('bounded-c', 'bounded-c@example.test', 'bounded-c@example.test', 'C', 'Attendee', datetime('now'), datetime('now'))`,
    ).run();

    for (const userId of ["bounded-a", "bounded-b", "bounded-c"]) {
      const registration = await createRegistration(env.DB, {
        event,
        userId,
        attendanceType: "virtual",
        sourceType: "direct",
        confirmationTtlHours: 48,
        signingSecret: "test-signing-secret",
      });
      await confirmRegistrationByToken(env.DB, {
        token: registration.confirmationToken as string,
        waitlistClaimWindowHours: 24,
        signingSecret: "test-signing-secret",
      });
    }

    type ListResponse = {
      registrations: Array<{ id: string }>;
      page: { limit: number; offset: number; total: number; hasMore: boolean };
    };

    const page1Res = await callAdmin("/api/v1/admin/events/pqc-2026/registrations?limit=2&offset=0");
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as ListResponse;
    expect(page1.registrations).toHaveLength(2);
    expect(page1.page).toEqual({ limit: 2, offset: 0, total: 3, hasMore: true });

    const page2Res = await callAdmin("/api/v1/admin/events/pqc-2026/registrations?limit=2&offset=2");
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as ListResponse;
    expect(page2.registrations).toHaveLength(1);
    expect(page2.page).toEqual({ limit: 2, offset: 2, total: 3, hasMore: false });

    const ids = new Set([...page1.registrations, ...page2.registrations].map((r) => r.id));
    expect(ids.size).toBe(3);

    const invalidLimitRes = await callAdmin("/api/v1/admin/events/pqc-2026/registrations?limit=not-a-number");
    expect(invalidLimitRes.status).toBe(400);
  });

  // PR #1 review Phase 4 item 1: bare GET/POST /admin/events previously had
  // no permission check at all beyond bare authentication — any
  // authenticated staff-portal actor, including one with zero role or
  // permission grants, could list events and (more seriously) create new
  // ones. Now requires events:read/events:write respectively.
  it("a staff user without events:write cannot create an event, and without events:read cannot list them", async () => {
    await setupAdmin();
    const staffId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'no-events-perm@example.test', 'no-events-perm@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(staffId)
      .run();
    // Grants a role unrelated to events so the user passes
    // STAFF_ACCESS_CONDITION (can obtain a session at all).
    await env.DB.prepare(
      `INSERT INTO user_roles (id, user_id, role_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'role-membership_processor', NULL, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffId, "no-events-perm-token");

    const createResponse = await app.fetch(
      new Request("https://app.test/api/v1/admin/events", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${staffToken}` },
        body: JSON.stringify({
          slug: "should-not-be-created",
          name: "Should Not Be Created",
          timezone: "Europe/Amsterdam",
          registrationMode: "open",
          inviteLimitAttendee: 10,
        }),
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(createResponse.status).toBe(403);

    const listResponse = await app.fetch(
      new Request("https://app.test/api/v1/admin/events", {
        headers: { authorization: `Bearer ${staffToken}` },
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(listResponse.status).toBe(403);
  });
});
