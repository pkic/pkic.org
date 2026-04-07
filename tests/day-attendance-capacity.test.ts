import { describe, expect, it, beforeEach} from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration, confirmRegistrationByToken, updateRegistrationByManageToken } from "../functions/_lib/services/registrations";
import { promoteDayWaitlistIfCapacity } from "../functions/_lib/services/registrations/day-waitlist";

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

  it("lets an attendee cancel the whole registration when a selected day is still pending", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-1', 'cancel-one@example.test', 'cancel-one@example.test', 'Cancel', 'One', datetime('now'), datetime('now')),
          ('user-2', 'cancel-two@example.test', 'cancel-two@example.test', 'Cancel', 'Two', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const first = await createRegistration(env.DB, {
      event,
      userId: "user-1",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    await confirmRegistrationByToken(env.DB, {
      token: first.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    const second = await createRegistration(env.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    const confirmedSecond = await confirmRegistrationByToken(env.DB, {
      token: second.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    const cancelled = await updateRegistrationByManageToken(env.DB, {
      manageToken: confirmedSecond.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
    });

    expect(cancelled.status).toBe("cancelled");

    const waitlist = await queryAll<{ status: string }>(env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
      [second.registration.id],
    );
    expect(waitlist[0].status).toBe("removed");
  });

  it("offers the pending day when more capacity becomes available", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-1', 'capacity-up-one@example.test', 'capacity-up-one@example.test', 'Capacity', 'One', datetime('now'), datetime('now')),
          ('user-2', 'capacity-up-two@example.test', 'capacity-up-two@example.test', 'Capacity', 'Two', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const first = await createRegistration(env.DB, {
      event,
      userId: "user-1",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    await confirmRegistrationByToken(env.DB, {
      token: first.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    const second = await createRegistration(env.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    const confirmedSecond = await confirmRegistrationByToken(env.DB, {
      token: second.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    await env.DB.prepare("UPDATE event_days SET in_person_capacity = 2, updated_at = datetime('now') WHERE id = 'day-1'").run();

    const promoted = await promoteDayWaitlistIfCapacity(env.DB, {
      eventId,
      eventDayId: "day-1",
      claimWindowHours: 24,
    });

    expect(promoted?.registration_id).toBe(second.registration.id);
    expect(promoted?.status).toBe("offered");

    const beforeClaim = await queryAll<{ status: string }>(env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
      [second.registration.id],
    );
    expect(beforeClaim[0].status).toBe("offered");

    await updateRegistrationByManageToken(env.DB, {
      manageToken: confirmedSecond.manageToken,
      action: "update",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      waitlistClaimWindowHours: 24,
    });

    const afterClaim = await queryAll<{ status: string }>(env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
      [second.registration.id],
    );
    expect(afterClaim[0].status).toBe("accepted");
  });
});
