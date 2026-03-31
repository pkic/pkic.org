import { describe, expect, it, beforeEach} from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration } from "../functions/_lib/services/registrations";

describe("day attendance capacity", () => {
  beforeEach(async () => { await resetDb(); });
  it("waitlists only the full day instead of rejecting registration", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('${crypto.randomUUID()}', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('${crypto.randomUUID()}', 'attendee-one@example.test', 'attendee-one@example.test', 'Attendee', 'One', datetime('now'), datetime('now')),
          ('${crypto.randomUUID()}', 'attendee-two@example.test', 'attendee-two@example.test', 'Attendee', 'Two', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const firstUser = ((await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'attendee-one@example.test'")))[0];
    const secondUser = ((await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'attendee-two@example.test'")))[0];

    await createRegistration(env.DB, {
      event,
      userId: firstUser.id,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });

    const second = await createRegistration(env.DB, {
      event,
      userId: secondUser.id,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });

    expect(second.registration.status).toBe("pending_email_confirmation");
    const waitlist = await queryAll<{ status: string; priority_lane: string }>(env.DB, 
      "SELECT status, priority_lane FROM event_day_waitlist_entries WHERE registration_id = ?",
      [second.registration.id],
    );
    expect(waitlist).toHaveLength(1);
    expect(waitlist[0].status).toBe("waiting");
    expect(waitlist[0].priority_lane).toBe("general");
  });
});
