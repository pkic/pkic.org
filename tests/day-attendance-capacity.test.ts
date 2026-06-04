import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  createRegistration,
  confirmRegistrationByToken,
  updateRegistrationById,
  updateRegistrationByManageToken,
} from "../functions/_lib/services/registrations";
import { promoteDayWaitlistIfCapacity } from "../functions/_lib/services/registrations/day-waitlist";
import { promoteEventWaitlistWithNotifications } from "../functions/_lib/services/registrations/waitlist-promotions";

describe("day attendance capacity", () => {
  beforeEach(async () => {
    await resetDb();
  });
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

    const firstUser = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'attendee-one@example.test'")
    )[0];
    const secondUser = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'attendee-two@example.test'")
    )[0];

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
    const waitlist = await queryAll<{ status: string; priority_lane: string }>(
      env.DB,
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

    const waitlist = await queryAll<{ status: string }>(
      env.DB,
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

    await env.DB.prepare(
      "UPDATE event_days SET in_person_capacity = 2, updated_at = datetime('now') WHERE id = 'day-1'",
    ).run();

    const promoted = await promoteDayWaitlistIfCapacity(env.DB, {
      eventId,
      eventDayId: "day-1",
      claimWindowHours: 24,
    });

    expect(promoted?.registration_id).toBe(second.registration.id);
    expect(promoted?.status).toBe("offered");

    const beforeClaim = await queryAll<{ status: string }>(
      env.DB,
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

    const afterClaim = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
      [second.registration.id],
    );
    expect(afterClaim[0].status).toBe("accepted");
  });

  it("keeps existing confirmed days when claiming another day's waitlist offer", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES
          ('day-tue', '${eventId}', '2026-12-01', 'Tuesday', 1, 10, datetime('now'), datetime('now')),
          ('day-wed', '${eventId}', '2026-12-02', 'Wednesday', 1, 20, datetime('now'), datetime('now')),
          ('day-thu', '${eventId}', '2026-12-03', 'Thursday', 1, 30, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-tue-holder', 'tue-holder@example.test', 'tue-holder@example.test', 'Tuesday', 'Holder', datetime('now'), datetime('now')),
          ('user-attendee', 'attendee@example.test', 'attendee@example.test', 'Main', 'Attendee', datetime('now'), datetime('now')),
          ('user-thu-other', 'thu-other@example.test', 'thu-other@example.test', 'Thursday', 'Other', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const tueHolder = await createRegistration(env.DB, {
      event,
      userId: "user-tue-holder",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    await confirmRegistrationByToken(env.DB, {
      token: tueHolder.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    const attendee = await createRegistration(env.DB, {
      event,
      userId: "user-attendee",
      attendanceType: "in_person",
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "in_person" },
        { dayDate: "2026-12-02", attendanceType: "in_person" },
        { dayDate: "2026-12-03", attendanceType: "in_person" },
      ],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    const confirmedAttendee = await confirmRegistrationByToken(env.DB, {
      token: attendee.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    await env.DB.prepare(
      "UPDATE event_days SET in_person_capacity = 2, updated_at = datetime('now') WHERE id = 'day-thu'",
    ).run();
    const thursdayOther = await createRegistration(env.DB, {
      event,
      userId: "user-thu-other",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-03", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    await confirmRegistrationByToken(env.DB, {
      token: thursdayOther.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });
    await env.DB.prepare(
      "UPDATE event_days SET in_person_capacity = 1, updated_at = datetime('now') WHERE id = 'day-thu'",
    ).run();

    await updateRegistrationById(
      env.DB,
      {
        registrationId: tueHolder.registration.id,
        action: "cancel",
        waitlistClaimWindowHours: 24,
      },
      "test",
    );

    await promoteDayWaitlistIfCapacity(env.DB, {
      eventId,
      eventDayId: "day-tue",
      claimWindowHours: 24,
    });

    await updateRegistrationByManageToken(env.DB, {
      manageToken: confirmedAttendee.manageToken,
      action: "update",
      attendanceType: "in_person",
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "in_person" },
        { dayDate: "2026-12-02", attendanceType: "in_person" },
        { dayDate: "2026-12-03", attendanceType: "in_person" },
      ],
      waitlistClaimWindowHours: 24,
    });

    const waitlistRows = await queryAll<{ day_date: string; status: string }>(
      env.DB,
      `SELECT ed.day_date, w.status
       FROM event_day_waitlist_entries w
       JOIN event_days ed ON ed.id = w.event_day_id
       WHERE w.registration_id = ?
       ORDER BY ed.day_date ASC`,
      [attendee.registration.id],
    );

    expect(waitlistRows.find((row) => row.day_date === "2026-12-01")?.status).toBe("accepted");
    expect(waitlistRows.find((row) => row.day_date === "2026-12-03")?.status).toBeUndefined();
  });

  it("does not offer the same opened seat to multiple waitlisted attendees", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-1', 'reserve-one@example.test', 'reserve-one@example.test', 'Reserve', 'One', datetime('now'), datetime('now')),
          ('user-2', 'reserve-two@example.test', 'reserve-two@example.test', 'Reserve', 'Two', datetime('now'), datetime('now')),
          ('user-3', 'reserve-three@example.test', 'reserve-three@example.test', 'Reserve', 'Three', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    for (const userId of ["user-1", "user-2", "user-3"]) {
      const registration = await createRegistration(env.DB, {
        event,
        userId,
        attendanceType: "in_person",
        dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
        sourceType: "direct",
        confirmationTtlHours: 48,
      });
      await confirmRegistrationByToken(env.DB, {
        token: registration.confirmationToken as string,
        waitlistClaimWindowHours: 24,
      });
    }

    await env.DB.prepare(
      "UPDATE event_days SET in_person_capacity = 2, updated_at = datetime('now') WHERE id = 'day-1'",
    ).run();

    const result = await promoteEventWaitlistWithNotifications(env.DB, {
      event,
      appBaseUrl: "https://app.test",
      claimWindowHours: 24,
      source: {
        actorType: "system",
        actorId: null,
        auditAction: "system_waitlist_promoted",
        source: "test",
      },
    });

    expect(result.dayRegistrationOffers).toBe(1);

    const statuses = await queryAll<{ status: string; total: number }>(
      env.DB,
      "SELECT status, COUNT(*) AS total FROM event_day_waitlist_entries WHERE event_day_id = 'day-1' GROUP BY status",
    );
    expect(Number(statuses.find((row) => row.status === "offered")?.total ?? 0)).toBe(1);
    expect(Number(statuses.find((row) => row.status === "waiting")?.total ?? 0)).toBe(1);
  });

  it("restores an expired explicit offer attempt to its old waitlist position", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-1', 'expired-holder@example.test', 'expired-holder@example.test', 'Expired', 'Holder', datetime('now'), datetime('now')),
          ('user-2', 'expired-waiting@example.test', 'expired-waiting@example.test', 'Expired', 'Waiting', datetime('now'), datetime('now')),
          ('user-3', 'expired-backup@example.test', 'expired-backup@example.test', 'Expired', 'Backup', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const holder = await createRegistration(env.DB, {
      event,
      userId: "user-1",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    await confirmRegistrationByToken(env.DB, {
      token: holder.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    const waiting = await createRegistration(env.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    const confirmedWaiting = await confirmRegistrationByToken(env.DB, {
      token: waiting.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    const backup = await createRegistration(env.DB, {
      event,
      userId: "user-3",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    await confirmRegistrationByToken(env.DB, {
      token: backup.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    await updateRegistrationById(
      env.DB,
      {
        registrationId: holder.registration.id,
        action: "cancel",
        waitlistClaimWindowHours: 24,
      },
      "test",
    );

    await env.DB.prepare(
      `UPDATE event_day_waitlist_entries
       SET status = 'offered', offer_expires_at = datetime('now', '-1 day'), updated_at = datetime('now')
       WHERE registration_id = ?`,
    )
      .bind(waiting.registration.id)
      .run();

    await updateRegistrationById(
      env.DB,
      {
        registrationId: confirmedWaiting.registration.id,
        action: "update",
        attendanceType: "in_person",
        dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
        waitlistClaimWindowHours: 24,
      },
      "test",
    );

    const rows = await queryAll<{ registration_id: string; status: string; position: number }>(
      env.DB,
      "SELECT registration_id, status, position FROM event_day_waitlist_entries WHERE event_day_id = 'day-1' ORDER BY position ASC",
    );

    expect(rows.find((row) => row.registration_id === waiting.registration.id)?.status).toBe("waiting");
    expect(rows.find((row) => row.registration_id === waiting.registration.id)?.position).toBe(1);
    expect(rows.find((row) => row.registration_id === backup.registration.id)?.position).toBe(2);
  });
});
