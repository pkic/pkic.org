import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  createRegistration,
  updateRegistrationById,
  updateRegistrationByManageToken,
} from "../functions/_lib/services/registrations";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

describe("day waitlist queue fairness", () => {
  beforeEach(resetDb);

  it("counts a role-exempt attendee toward physical capacity for an ordinary registration", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
         VALUES ('physical-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
      ).bind(eventId),
      ...["organizer", "attendee"].map((id) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(id, `${id}@example.test`, `${id}@example.test`),
      ),
      env.DB.prepare(
        `INSERT INTO event_participants
         (id, event_id, user_id, role, status, source_type, created_at, updated_at)
         VALUES ('organizer-participant', ?, 'organizer', 'organizer', 'active', 'test', datetime('now'), datetime('now'))`,
      ).bind(eventId),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const common = {
      event,
      attendanceType: "in_person" as const,
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" as const }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    };

    const organizer = await createRegistration(env.DB, { ...common, userId: "organizer" });
    expect(organizer.registration.capacity_exempt_in_person).toBe(1);
    const attendee = await createRegistration(env.DB, { ...common, userId: "attendee" });

    expect(
      await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
        [attendee.registration.id],
      ),
    ).toEqual([{ status: "waiting" }]);
  });

  it("counts an admin-admitted day toward physical capacity for an ordinary registration", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
         VALUES ('admitted-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
      ).bind(eventId),
      ...["admitted", "attendee"].map((id) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(id, `${id}@example.test`, `${id}@example.test`),
      ),
      env.DB.prepare(
        `INSERT INTO registrations
         (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
         VALUES ('admitted-registration', ?, 'admitted', 'registered', 'in_person', 'direct', 'secret', datetime('now'), datetime('now'))`,
      ).bind(eventId),
      env.DB.prepare(
        `INSERT INTO registration_day_attendance
         (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
         VALUES ('admitted-attendance', 'admitted-registration', 'admitted-day', 'in_person', datetime('now'), datetime('now'))`,
      ),
      env.DB.prepare(
        `INSERT INTO event_day_waitlist_entries
         (id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position, reason_code, created_at, updated_at)
         VALUES ('admitted-waitlist', ?, 'admitted-day', 'admitted-registration', 'admitted', 'general', 'accepted', 1,
                 'admin_capacity_exempt', datetime('now'), datetime('now'))`,
      ).bind(eventId),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const attendee = await createRegistration(env.DB, {
      event,
      userId: "attendee",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    expect(
      await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
        [attendee.registration.id],
      ),
    ).toEqual([{ status: "waiting" }]);
  });

  it("keeps an opened seat for earlier waitlisted attendees across registration and self-service updates", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
         VALUES ('queue-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
      ).bind(eventId),
      ...["holder", "waiting", "direct", "editing"].map((id) =>
        env.DB.prepare(
          `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        ).bind(id, `${id}@example.test`, `${id}@example.test`),
      ),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const common = {
      event,
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    };
    const inPerson = [{ dayDate: "2026-12-01", attendanceType: "in_person" as const }];
    const virtual = [{ dayDate: "2026-12-01", attendanceType: "virtual" as const }];

    const holder = await createRegistration(env.DB, {
      ...common,
      userId: "holder",
      attendanceType: "in_person",
      dayAttendance: inPerson,
    });
    const firstWaiting = await createRegistration(env.DB, {
      ...common,
      userId: "waiting",
      attendanceType: "in_person",
      dayAttendance: inPerson,
    });
    const editing = await createRegistration(env.DB, {
      ...common,
      userId: "editing",
      attendanceType: "virtual",
      dayAttendance: virtual,
    });

    await updateRegistrationById(
      env.DB,
      { eventId, registrationId: holder.registration.id, action: "cancel" },
      "admin",
    );

    const direct = await createRegistration(env.DB, {
      ...common,
      userId: "direct",
      attendanceType: "in_person",
      dayAttendance: inPerson,
    });
    await updateRegistrationByManageToken(env.DB, {
      manageToken: editing.manageToken,
      signingSecret: common.signingSecret,
      action: "update",
      dayAttendance: inPerson,
    });

    const rows = await queryAll<{ registration_id: string; status: string; position: number }>(
      env.DB,
      `SELECT registration_id, status, position FROM event_day_waitlist_entries
       WHERE event_day_id = 'queue-day' AND status = 'waiting' ORDER BY position`,
    );
    expect(rows.map(({ registration_id, status }) => ({ registration_id, status }))).toEqual([
      { registration_id: firstWaiting.registration.id, status: "waiting" },
      { registration_id: direct.registration.id, status: "waiting" },
      { registration_id: editing.registration.id, status: "waiting" },
    ]);
    expect(rows.map((row) => row.position)).toEqual([1, 2, 3]);
  });
});
