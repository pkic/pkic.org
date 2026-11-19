/**
 * A venue option can name another option of the same day as its waitlist alternative. Every
 * registration email reads that alternative from the day's configuration in the queries it
 * already runs: a new or changed registration, the status notification and the campaign projection.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import { buildCreateRegistration, createRegistration } from "../functions/_lib/services/registrations/create";
import { buildRegistrationUpdate } from "../functions/_lib/services/registrations/update-plan";
import { getRegistrationDayAttendance } from "../functions/_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../functions/_lib/services/registrations/day-waitlist-queries";
import { projectAttendeeDayState } from "../functions/_lib/services/event-email-campaign/attendance-projection";
import { buildAttendanceEmailData } from "../functions/_lib/utils/attendance";

const lounge = {
  value: "livestream_lounge",
  label: "Livestream Lounge",
  description: "Watch together at a partner venue.",
  accessMode: "physical",
  capacity: 50,
};

async function seedFullDay(options: unknown[]) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, attendance_options_json, sort_order, created_at, updated_at)
       VALUES ('day-1', ?, '2026-12-01', 'Day 1', 1, ?, 10, datetime('now'), datetime('now'))`,
    ).bind(eventId, JSON.stringify(options)),
    env.DB.prepare(`INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
      VALUES ('user-1', 'seated@example.test', 'seated@example.test', 'Seated', 'One', datetime('now'), datetime('now')),
             ('user-2', 'waiting@example.test', 'waiting@example.test', 'Waiting', 'Two', datetime('now'), datetime('now'))`),
  ]);
  const event = await getEventBySlug(env.DB, "pqc-2026");
  const register = (userId: string) => ({
    event,
    userId,
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    sourceType: "direct" as const,
    confirmationTtlHours: 48,
    signingSecret: "test-signing-secret",
  });
  await createRegistration(env.DB, register("user-1"));
  return { register };
}

describe("waitlist alternative email data", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("suggests the configured alternative for a waitlisted venue day in every email data source", async () => {
    const { register } = await seedFullDay([
      { value: "in_person", label: "In person", capacity: 1, waitlistAlternative: "livestream_lounge" },
      lounge,
    ]);
    const expected = [{ label: "Livestream Lounge", description: "Watch together at a partner venue", limited: true }];

    const planned = await buildCreateRegistration(env.DB, register("user-2"));
    expect(planned.plannedDayWaitlist).toMatchObject([{ dayDate: "2026-12-01", status: "waiting" }]);
    expect(buildAttendanceEmailData(planned.dayAttendance, planned.plannedDayWaitlist).waitlistAlternatives).toEqual(
      expected,
    );

    const { registration } = await createRegistration(env.DB, register("user-2"));
    const waitlist = await listDayWaitlistForRegistration(env.DB, registration.id);
    const days = await getRegistrationDayAttendance(env.DB, registration.id);
    expect(buildAttendanceEmailData(days, waitlist).waitlistAlternatives).toEqual(expected);

    const update = await buildRegistrationUpdate(env.DB, registration, {
      action: "update",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    });
    expect(update.dayAttendance).toMatchObject([{ optionLabel: "In person" }]);
    expect(buildAttendanceEmailData(update.dayAttendance!, update.dayWaitlist).waitlistAlternatives).toEqual(expected);

    const projection = await projectAttendeeDayState(env.DB, [registration.id]);
    expect(
      buildAttendanceEmailData(
        projection.attendanceByRegistration.get(registration.id)!,
        projection.waitlistByRegistration.get(registration.id)!,
      ).waitlistAlternatives,
    ).toEqual(expected);
  });

  it("suggests nothing when the day no longer offers the alternative or names none", async () => {
    const { register } = await seedFullDay([
      { value: "in_person", label: "In person", capacity: 1, waitlistAlternative: "livestream_lounge" },
      { ...lounge, capacity: null, enabled: false },
    ]);
    const { registration } = await createRegistration(env.DB, register("user-2"));
    const waitlist = await listDayWaitlistForRegistration(env.DB, registration.id);
    expect(waitlist).toMatchObject([{ status: "waiting" }]);
    expect(
      buildAttendanceEmailData(await getRegistrationDayAttendance(env.DB, registration.id), waitlist)
        .waitlistAlternatives,
    ).toEqual([]);

    await env.DB.prepare(`UPDATE event_days SET attendance_options_json = ? WHERE id = 'day-1'`)
      .bind(JSON.stringify([{ value: "in_person", label: "In person", capacity: 1 }, lounge]))
      .run();
    expect(
      buildAttendanceEmailData(await getRegistrationDayAttendance(env.DB, registration.id), waitlist)
        .waitlistAlternatives,
    ).toEqual([]);
  });
});
