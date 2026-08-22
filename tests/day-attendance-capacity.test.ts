import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  admitRegistration,
  createRegistration,
  confirmRegistrationByToken,
  forceRegistrationStatus,
  updateRegistrationById,
  updateRegistrationByManageToken,
} from "../functions/_lib/services/registrations";
import { updateAdminRegistrationDayAttendance } from "../functions/_lib/services/registrations/admin-day-attendance";
import { promoteDayWaitlistIfCapacity } from "../functions/_lib/services/registrations/day-waitlist";
import { buildCreateRegistration } from "../functions/_lib/services/registrations/create";
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
      signingSecret: "test-signing-secret",
    });

    const second = await createRegistration(env.DB, {
      event,
      userId: secondUser.id,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
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

  it("removes a pending day waitlist when confirmation becomes role-capacity-exempt", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
         VALUES ('role-exempt-day', ?, '2026-12-01', 'Day 1', 1, 0, datetime('now'), datetime('now'))`,
      ).bind(eventId),
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
         VALUES
           ('role-exempt-holder', 'role-exempt-holder@example.test', 'role-exempt-holder@example.test', 'Seat', 'Holder', datetime('now'), datetime('now')),
           ('role-exempt-pending', 'role-exempt-pending@example.test', 'role-exempt-pending@example.test', 'Role', 'Exempt', datetime('now'), datetime('now'))`,
      ),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const holder = await createRegistration(env.DB, {
      event,
      userId: "role-exempt-holder",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: holder.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const pending = await createRegistration(env.DB, {
      event,
      userId: "role-exempt-pending",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?", [
        pending.registration.id,
      ]),
    ).resolves.toEqual([{ status: "waiting" }]);

    await env.DB.prepare(
      `INSERT INTO event_participants (
         id, event_id, user_id, role, subrole, status, source_type, source_ref, created_at, updated_at
       ) VALUES ('role-exempt-participant', ?, 'role-exempt-pending', 'speaker', NULL, 'active', 'test', 'role-exempt', datetime('now'), datetime('now'))`,
    )
      .bind(eventId)
      .run();

    const confirmed = await confirmRegistrationByToken(env.DB, {
      token: pending.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    expect(confirmed.registration.capacity_exempt_in_person).toBe(1);

    await expect(
      queryAll<{ status: string; reason_code: string }>(
        env.DB,
        "SELECT status, reason_code FROM event_day_waitlist_entries WHERE registration_id = ?",
        [pending.registration.id],
      ),
    ).resolves.toEqual([{ status: "removed", reason_code: "capacity_exempt" }]);

    // Defense in depth for legacy stale rows: an exempt registration must
    // never be selected by promotion even if an old row survives cleanup.
    await env.DB.prepare(
      `UPDATE event_day_waitlist_entries SET status = 'waiting', reason_code = NULL, updated_at = datetime('now')
       WHERE registration_id = ?`,
    )
      .bind(pending.registration.id)
      .run();
    await env.DB.prepare("UPDATE event_days SET in_person_capacity = 2 WHERE id = 'role-exempt-day'").run();

    const promoted = await promoteDayWaitlistIfCapacity(env.DB, {
      eventId,
      eventDayId: "role-exempt-day",
      claimWindowHours: 24,
    });
    expect(promoted).toBeNull();
    await expect(
      queryAll<{ status: string }>(env.DB, "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?", [
        pending.registration.id,
      ]),
    ).resolves.toEqual([{ status: "waiting" }]);
  });

  it("rejects a stale final-seat plan and rebuilds the losing registration as waitlisted", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-final-seat', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-final-seat-a', 'final-seat-a@example.test', 'final-seat-a@example.test', 'Final', 'A', datetime('now'), datetime('now')),
          ('user-final-seat-b', 'final-seat-b@example.test', 'final-seat-b@example.test', 'Final', 'B', datetime('now'), datetime('now'))
      `),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const common = {
      event,
      attendanceType: "in_person" as const,
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    };

    // Both plans intentionally read the same capacity revision, as two
    // concurrent requests can do before either batch acquires D1's writer.
    const [firstPlan, stalePlan] = await Promise.all([
      buildCreateRegistration(env.DB, { ...common, userId: "user-final-seat-a" }),
      buildCreateRegistration(env.DB, { ...common, userId: "user-final-seat-b" }),
    ]);
    await env.DB.batch(firstPlan.statements);
    await expect(env.DB.batch(stalePlan.statements)).rejects.toThrow(/EVENT_DAY_CAPACITY_CHANGED/);

    const rebuilt = await createRegistration(env.DB, { ...common, userId: "user-final-seat-b" });
    const rows = await queryAll<{ registration_id: string; status: string }>(
      env.DB,
      `SELECT registration_id, status
       FROM event_day_waitlist_entries
       WHERE event_day_id = 'day-final-seat' AND status IN ('waiting', 'offered')`,
    );
    expect(rows).toEqual([{ registration_id: rebuilt.registration.id, status: "waiting" }]);

    const confirmedSeats = await queryAll<{ total: number }>(
      env.DB,
      `SELECT COUNT(*) AS total
       FROM registration_day_attendance rda
       LEFT JOIN event_day_waitlist_entries w
         ON w.event_day_id = rda.event_day_id AND w.registration_id = rda.registration_id
        AND w.status IN ('waiting', 'offered')
       WHERE rda.event_day_id = 'day-final-seat'
         AND rda.attendance_type = 'in_person'
         AND w.id IS NULL`,
    );
    expect(Number(confirmedSeats[0].total)).toBe(1);
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
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: first.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const second = await createRegistration(env.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const confirmedSecond = await confirmRegistrationByToken(env.DB, {
      token: second.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const cancelled = await updateRegistrationByManageToken(env.DB, {
      manageToken: confirmedSecond.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    expect(cancelled.status).toBe("cancelled");

    const waitlist = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
      [second.registration.id],
    );
    expect(waitlist[0].status).toBe("removed");
  });

  it("requires an explicit claim before accepting an offered day", async () => {
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
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: first.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const second = await createRegistration(env.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const confirmedSecond = await confirmRegistrationByToken(env.DB, {
      token: second.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
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
      signingSecret: "test-signing-secret",
    });

    const afterUnrelatedUpdate = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
      [second.registration.id],
    );
    expect(afterUnrelatedUpdate[0].status).toBe("offered");

    await updateRegistrationByManageToken(env.DB, {
      manageToken: confirmedSecond.manageToken,
      action: "update",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      claimDayWaitlistOffers: ["2026-12-01"],
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const afterExplicitClaim = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
      [second.registration.id],
    );
    expect(afterExplicitClaim[0].status).toBe("accepted");
  });

  it("lets an admin return an admitted day to the capacity-managed waitlist", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-admin-return', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-admin-holder', 'admin-holder@example.test', 'admin-holder@example.test', 'Seat', 'Holder', datetime('now'), datetime('now')),
          ('user-admin-return', 'admin-return@example.test', 'admin-return@example.test', 'Admin', 'Return', datetime('now'), datetime('now'))
      `),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const holder = await createRegistration(env.DB, {
      event,
      userId: "user-admin-holder",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: holder.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    const attendee = await createRegistration(env.DB, {
      event,
      userId: "user-admin-return",
      attendanceType: "virtual",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "virtual" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: attendee.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    const admin = (
      await queryAll<{ id: string; email: string }>(env.DB, "SELECT id, email FROM users WHERE role = 'admin' LIMIT 1")
    )[0];
    await updateAdminRegistrationDayAttendance(
      env.DB,
      { identityType: "user", id: admin.id, email: admin.email, role: "admin" },
      {
        eventSlug: event.slug,
        registrationId: attendee.registration.id,
        change: { action: "in_person", dayDates: ["2026-12-01"] },
        appBaseUrl: "https://example.test",
      },
    );
    const beforeOverride = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = 'day-admin-return'",
      [attendee.registration.id],
    );
    expect(beforeOverride).toEqual([{ status: "waiting" }]);
    await admitRegistration(env.DB, {
      registrationId: attendee.registration.id,
      event,
      dayDates: ["2026-12-01"],
      mode: "capacity_exempt",
      reason: "Approved exception",
      actorUserId: admin.id,
      appBaseUrl: "https://example.test",
    });

    await updateAdminRegistrationDayAttendance(
      env.DB,
      { identityType: "user", id: admin.id, email: admin.email, role: "admin" },
      {
        eventSlug: event.slug,
        registrationId: attendee.registration.id,
        change: { action: "waitlist", dayDates: ["2026-12-01"] },
        appBaseUrl: "https://example.test",
      },
    );

    const [registration] = await queryAll<{ capacity_exempt_in_person: number }>(
      env.DB,
      "SELECT capacity_exempt_in_person FROM registrations WHERE id = ?",
      [attendee.registration.id],
    );
    const waitlist = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = 'day-admin-return'",
      [attendee.registration.id],
    );
    expect(registration.capacity_exempt_in_person).toBe(0);
    expect(waitlist).toEqual([{ status: "waiting" }]);
  });

  it("scopes an admin capacity override to the admitted day", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES
          ('day-admin-a', '${eventId}', '2026-12-01', 'Day A', 1, 10, datetime('now'), datetime('now')),
          ('day-admin-b', '${eventId}', '2026-12-02', 'Day B', 1, 20, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-holder-a', 'holder-a@example.test', 'holder-a@example.test', 'Holder', 'A', datetime('now'), datetime('now')),
          ('user-holder-b', 'holder-b@example.test', 'holder-b@example.test', 'Holder', 'B', datetime('now'), datetime('now')),
          ('user-day-scoped', 'day-scoped@example.test', 'day-scoped@example.test', 'Day', 'Scoped', datetime('now'), datetime('now'))
      `),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    for (const [userId, dayDate] of [
      ["user-holder-a", "2026-12-01"],
      ["user-holder-b", "2026-12-02"],
    ] as const) {
      const holder = await createRegistration(env.DB, {
        event,
        userId,
        attendanceType: "in_person",
        dayAttendance: [{ dayDate, attendanceType: "in_person" }],
        sourceType: "direct",
        confirmationTtlHours: 48,
        signingSecret: "test-signing-secret",
      });
      await confirmRegistrationByToken(env.DB, {
        token: holder.confirmationToken as string,
        waitlistClaimWindowHours: 24,
        signingSecret: "test-signing-secret",
      });
    }
    const attendee = await createRegistration(env.DB, {
      event,
      userId: "user-day-scoped",
      attendanceType: "virtual",
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "virtual" },
        { dayDate: "2026-12-02", attendanceType: "virtual" },
      ],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const confirmed = await confirmRegistrationByToken(env.DB, {
      token: attendee.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");
    await admitRegistration(env.DB, {
      registrationId: attendee.registration.id,
      event,
      dayDates: ["2026-12-01"],
      mode: "capacity_exempt",
      reason: "Day A only",
      actorUserId: admin.id,
      appBaseUrl: "https://example.test",
    });

    await updateRegistrationByManageToken(env.DB, {
      manageToken: confirmed.manageToken,
      action: "update",
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "in_person" },
        { dayDate: "2026-12-02", attendanceType: "in_person" },
      ],
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const [registration] = await queryAll<{ capacity_exempt_in_person: number }>(
      env.DB,
      "SELECT capacity_exempt_in_person FROM registrations WHERE id = ?",
      [attendee.registration.id],
    );
    const rows = await queryAll<{ day_date: string; status: string; reason_code: string | null }>(
      env.DB,
      `SELECT ed.day_date, w.status, w.reason_code
       FROM event_day_waitlist_entries w
       JOIN event_days ed ON ed.id = w.event_day_id
       WHERE w.registration_id = ?
       ORDER BY ed.day_date`,
      [attendee.registration.id],
    );
    expect(registration.capacity_exempt_in_person).toBe(0);
    expect(rows).toEqual([
      { day_date: "2026-12-01", status: "accepted", reason_code: "admin_capacity_exempt" },
      { day_date: "2026-12-02", status: "waiting", reason_code: null },
    ]);
  });

  it("re-applies day capacity when an admin restores a cancelled registration", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-force-restore', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-force-target', 'force-target@example.test', 'force-target@example.test', 'Force', 'Target', datetime('now'), datetime('now')),
          ('user-force-holder', 'force-holder@example.test', 'force-holder@example.test', 'Force', 'Holder', datetime('now'), datetime('now'))
      `),
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const target = await createRegistration(env.DB, {
      event,
      userId: "user-force-target",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const confirmedTarget = await confirmRegistrationByToken(env.DB, {
      token: target.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    await updateRegistrationByManageToken(env.DB, {
      manageToken: confirmedTarget.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    const holder = await createRegistration(env.DB, {
      event,
      userId: "user-force-holder",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: holder.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");

    await forceRegistrationStatus(env.DB, {
      registrationId: target.registration.id,
      eventId,
      status: "registered",
      actorUserId: admin.id,
    });

    const rows = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = 'day-force-restore'",
      [target.registration.id],
    );
    expect(rows).toEqual([{ status: "waiting" }]);
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
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: tueHolder.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
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
      signingSecret: "test-signing-secret",
    });
    const confirmedAttendee = await confirmRegistrationByToken(env.DB, {
      token: attendee.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
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
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: thursdayOther.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare(
      "UPDATE event_days SET in_person_capacity = 1, updated_at = datetime('now') WHERE id = 'day-thu'",
    ).run();

    await updateRegistrationById(
      env.DB,
      {
        eventId,
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
      claimDayWaitlistOffers: ["2026-12-01"],
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
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
        signingSecret: "test-signing-secret",
      });
      await confirmRegistrationByToken(env.DB, {
        token: registration.confirmationToken as string,
        waitlistClaimWindowHours: 24,
        signingSecret: "test-signing-secret",
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
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: holder.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const waiting = await createRegistration(env.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const confirmedWaiting = await confirmRegistrationByToken(env.DB, {
      token: waiting.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const backup = await createRegistration(env.DB, {
      event,
      userId: "user-3",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: backup.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    await updateRegistrationById(
      env.DB,
      {
        eventId: event.id,
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
        eventId: event.id,
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
