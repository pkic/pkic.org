import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration, updateRegistrationByManageToken } from "../functions/_lib/services/registrations";
import { updateAdminRegistrationDayAttendance } from "../functions/_lib/services/registrations/admin-day-attendance";
import { promoteDayWaitlistIfCapacity } from "../functions/_lib/services/registrations/day-waitlist";
import {
  promoteEventWaitlistWithNotifications,
  runWaitlistPromotionCycle,
} from "../functions/_lib/services/registrations/waitlist-promotions";

async function seedUsersAndInvites(
  _db: DatabaseLike,
  eventId: string,
  emails: string[],
): Promise<Record<string, { userId: string; inviteId: string }>> {
  const map: Record<string, { userId: string; inviteId: string }> = {};

  for (const email of emails) {
    const userId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES ('${userId}', '${email}', '${email}', 'User', '${email.split("@")[0]}', datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO invites (
          id, event_id, invitee_email, invite_type, link_secret, status, source_type, created_at
        ) VALUES (
          '${inviteId}', '${eventId}', '${email}', 'attendee', '${crypto.randomUUID().replaceAll("-", "")}', 'sent', 'direct', datetime('now')
        )
      `),
    ]);

    map[email] = { userId, inviteId };
  }

  return map;
}

describe("day waitlist priorities", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("promotes continuity lane before general lane", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.prepare(
      `
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES
        ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now')),
        ('day-2', '${eventId}', '2026-12-02', 'Day 2', 1, 20, datetime('now'), datetime('now'));
    `,
    ).run();

    const seeded = await seedUsersAndInvites(env.DB, eventId, [
      "holder@example.test",
      "continuity@example.test",
      "general@example.test",
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const holder = await createRegistration(env.DB, {
      event,
      userId: seeded["holder@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["holder@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const continuity = await createRegistration(env.DB, {
      event,
      userId: seeded["continuity@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "in_person" },
        { dayDate: "2026-12-02", attendanceType: "in_person" },
      ],
      sourceType: "invite",
      inviteId: seeded["continuity@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const general = await createRegistration(env.DB, {
      event,
      userId: seeded["general@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["general@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const lanes = await queryAll<{ registration_id: string; priority_lane: string }>(
      env.DB,
      "SELECT registration_id, priority_lane FROM event_day_waitlist_entries WHERE event_day_id = 'day-1' ORDER BY position ASC",
    );
    expect(lanes).toHaveLength(2);
    expect(lanes.find((row) => row.registration_id === continuity.registration.id)?.priority_lane).toBe("continuity");
    expect(lanes.find((row) => row.registration_id === general.registration.id)?.priority_lane).toBe("general");

    await updateRegistrationByManageToken(env.DB, {
      manageToken: holder.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const statuses = await queryAll<{ registration_id: string; status: string }>(
      env.DB,
      "SELECT registration_id, status FROM event_day_waitlist_entries WHERE event_day_id = 'day-1'",
    );

    expect(statuses.find((row) => row.registration_id === continuity.registration.id)?.status).toBe("waiting");
    expect(statuses.find((row) => row.registration_id === general.registration.id)?.status).toBe("waiting");

    await promoteEventWaitlistWithNotifications(env.DB, {
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

    const promotedStatuses = await queryAll<{ registration_id: string; status: string }>(
      env.DB,
      "SELECT registration_id, status FROM event_day_waitlist_entries WHERE event_day_id = 'day-1'",
    );

    expect(promotedStatuses.find((row) => row.registration_id === continuity.registration.id)?.status).toBe("offered");
    expect(promotedStatuses.find((row) => row.registration_id === general.registration.id)?.status).toBe("waiting");

    const outbox = await queryAll<{ template_key: string; recipient_email: string }>(
      env.DB,
      "SELECT template_key, recipient_email FROM email_outbox ORDER BY created_at DESC LIMIT 1",
    );
    expect(outbox[0].template_key).toBe("registration_waitlist_offer");
    expect(outbox[0].recipient_email).toBe("continuity@example.test");
  });

  it("allows only one active offer per user across event days", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.prepare(
      `
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES
        ('d1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now')),
        ('d2', '${eventId}', '2026-12-02', 'Day 2', 1, 20, datetime('now'), datetime('now'));
    `,
    ).run();

    const seeded = await seedUsersAndInvites(env.DB, eventId, [
      "holder-one@example.test",
      "holder-two@example.test",
      "multi@example.test",
      "backup@example.test",
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const holderOne = await createRegistration(env.DB, {
      event,
      userId: seeded["holder-one@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["holder-one@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const holderTwo = await createRegistration(env.DB, {
      event,
      userId: seeded["holder-two@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-02", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["holder-two@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const multi = await createRegistration(env.DB, {
      event,
      userId: seeded["multi@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "in_person" },
        { dayDate: "2026-12-02", attendanceType: "in_person" },
      ],
      sourceType: "invite",
      inviteId: seeded["multi@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const backup = await createRegistration(env.DB, {
      event,
      userId: seeded["backup@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-02", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["backup@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    await updateRegistrationByManageToken(env.DB, {
      manageToken: holderOne.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    await updateRegistrationByManageToken(env.DB, {
      manageToken: holderTwo.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    await promoteEventWaitlistWithNotifications(env.DB, {
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

    const multiStatuses = await queryAll<{ event_day_id: string; status: string }>(
      env.DB,
      "SELECT event_day_id, status FROM event_day_waitlist_entries WHERE registration_id = ? ORDER BY event_day_id",
      [multi.registration.id],
    );
    const backupStatuses = await queryAll<{ event_day_id: string; status: string }>(
      env.DB,
      "SELECT event_day_id, status FROM event_day_waitlist_entries WHERE registration_id = ? ORDER BY event_day_id",
      [backup.registration.id],
    );

    expect(multiStatuses.find((row) => row.event_day_id === "d1")?.status).toBe("offered");
    expect(multiStatuses.find((row) => row.event_day_id === "d2")?.status).toBe("waiting");
    expect(backupStatuses.find((row) => row.event_day_id === "d2")?.status).toBe("offered");
  });

  it("enforces one active offer when different event days promote the same user concurrently", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES
        ('race-d1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now')),
        ('race-d2', '${eventId}', '2026-12-02', 'Day 2', 1, 20, datetime('now'), datetime('now'));
    `,
    ).run();

    const seeded = await seedUsersAndInvites(env.DB, eventId, [
      "race-holder-one@example.test",
      "race-holder-two@example.test",
      "race-multi@example.test",
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const holderOne = await createRegistration(env.DB, {
      event,
      userId: seeded["race-holder-one@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["race-holder-one@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const holderTwo = await createRegistration(env.DB, {
      event,
      userId: seeded["race-holder-two@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-02", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["race-holder-two@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const multi = await createRegistration(env.DB, {
      event,
      userId: seeded["race-multi@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [
        { dayDate: "2026-12-01", attendanceType: "in_person" },
        { dayDate: "2026-12-02", attendanceType: "in_person" },
      ],
      sourceType: "invite",
      inviteId: seeded["race-multi@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await Promise.all([
      updateRegistrationByManageToken(env.DB, {
        manageToken: holderOne.manageToken,
        action: "cancel",
        waitlistClaimWindowHours: 24,
        signingSecret: "test-signing-secret",
      }),
      updateRegistrationByManageToken(env.DB, {
        manageToken: holderTwo.manageToken,
        action: "cancel",
        waitlistClaimWindowHours: 24,
        signingSecret: "test-signing-secret",
      }),
    ]);

    const [first, second] = await Promise.all([
      promoteDayWaitlistIfCapacity(env.DB, { eventId, eventDayId: "race-d1", claimWindowHours: 24 }),
      promoteDayWaitlistIfCapacity(env.DB, { eventId, eventDayId: "race-d2", claimWindowHours: 24 }),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    const statuses = await queryAll<{ event_day_id: string; status: string }>(
      env.DB,
      "SELECT event_day_id, status FROM event_day_waitlist_entries WHERE registration_id = ? ORDER BY event_day_id",
      [multi.registration.id],
    );
    expect(statuses.filter((row) => row.status === "offered")).toHaveLength(1);
    expect(statuses.filter((row) => row.status === "waiting")).toHaveLength(1);
  });

  it("rolls back the offer and audit when durable notification enqueue fails", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
       VALUES ('failure-day', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))`,
    ).run();
    const seeded = await seedUsersAndInvites(env.DB, eventId, [
      "failure-holder@example.test",
      "failure-waiting@example.test",
    ]);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const holder = await createRegistration(env.DB, {
      event,
      userId: seeded["failure-holder@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["failure-holder@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const waiting = await createRegistration(env.DB, {
      event,
      userId: seeded["failure-waiting@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["failure-waiting@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await updateRegistrationByManageToken(env.DB, {
      manageToken: holder.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });
    await env.DB.prepare(
      `CREATE TRIGGER reject_waitlist_offer_outbox
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'registration_waitlist_offer'
       BEGIN
         SELECT RAISE(ABORT, 'forced waitlist outbox failure');
       END`,
    ).run();
    try {
      await expect(
        promoteEventWaitlistWithNotifications(env.DB, {
          event,
          appBaseUrl: "https://app.test",
          claimWindowHours: 24,
          source: {
            actorType: "system",
            actorId: null,
            auditAction: "system_waitlist_promoted",
            source: "failure-test",
          },
        }),
      ).rejects.toThrow("forced waitlist outbox failure");
      const [waitlist] = await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
        [waiting.registration.id],
      );
      expect(waitlist.status).toBe("waiting");
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'system_waitlist_promoted'")).toHaveLength(
        0,
      );
      expect(
        await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'registration_waitlist_offer'"),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_waitlist_offer_outbox").run();
    }
  });

  it("scheduled promotion cycle queues waitlist offer email and audit log", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.prepare(
      `
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'));
    `,
    ).run();

    const seeded = await seedUsersAndInvites(env.DB, eventId, ["holder@example.test", "waiting@example.test"]);
    const event = await getEventBySlug(env.DB, "pqc-2026");

    const holder = await createRegistration(env.DB, {
      event,
      userId: seeded["holder@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["holder@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const waiting = await createRegistration(env.DB, {
      event,
      userId: seeded["waiting@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["waiting@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    await updateRegistrationByManageToken(env.DB, {
      manageToken: holder.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const result = await runWaitlistPromotionCycle(env.DB, {
      appBaseUrl: "https://app.test",
      claimWindowHours: 24,
      limit: 10,
    });

    expect(result.dayRegistrationOffers).toBe(1);
    expect(result.affectedRegistrations).toBe(1);

    const waitlistRows = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?",
      [waiting.registration.id],
    );
    expect(waitlistRows[0].status).toBe("offered");

    const outbox = await queryAll<{ template_key: string; recipient_email: string }>(
      env.DB,
      "SELECT template_key, recipient_email FROM email_outbox ORDER BY created_at DESC LIMIT 1",
    );
    expect(outbox[0].template_key).toBe("registration_waitlist_offer");
    expect(outbox[0].recipient_email).toBe("waiting@example.test");

    const audit = await queryAll<{ action: string }>(
      env.DB,
      "SELECT action FROM audit_log WHERE action = 'system_waitlist_promoted'",
    );
    expect(audit).toHaveLength(1);
  });

  it("does not create duplicate offers or emails when promotion runs twice at once", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.prepare(
      `
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'));
    `,
    ).run();

    const seeded = await seedUsersAndInvites(env.DB, eventId, [
      "holder@example.test",
      "first-waiting@example.test",
      "second-waiting@example.test",
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const holder = await createRegistration(env.DB, {
      event,
      userId: seeded["holder@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["holder@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    await createRegistration(env.DB, {
      event,
      userId: seeded["first-waiting@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["first-waiting@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    await createRegistration(env.DB, {
      event,
      userId: seeded["second-waiting@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["second-waiting@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    await updateRegistrationByManageToken(env.DB, {
      manageToken: holder.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    await Promise.all([
      promoteEventWaitlistWithNotifications(env.DB, {
        event,
        appBaseUrl: "https://app.test",
        claimWindowHours: 24,
        source: {
          actorType: "system",
          actorId: null,
          auditAction: "system_waitlist_promoted",
          source: "parallel-a",
        },
      }),
      promoteEventWaitlistWithNotifications(env.DB, {
        event,
        appBaseUrl: "https://app.test",
        claimWindowHours: 24,
        source: {
          actorType: "system",
          actorId: null,
          auditAction: "system_waitlist_promoted",
          source: "parallel-b",
        },
      }),
    ]);

    const statusCounts = await queryAll<{ status: string; total: number }>(
      env.DB,
      "SELECT status, COUNT(*) AS total FROM event_day_waitlist_entries WHERE event_day_id = 'day-1' GROUP BY status",
    );
    expect(Number(statusCounts.find((row) => row.status === "offered")?.total ?? 0)).toBe(1);
    expect(Number(statusCounts.find((row) => row.status === "waiting")?.total ?? 0)).toBe(1);

    const offerEmails = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM email_outbox WHERE template_key = 'registration_waitlist_offer'",
    );
    expect(Number(offerEmails[0]?.total ?? 0)).toBe(1);
  });

  it("marks organizer registrations as capacity exempt", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.prepare(
      `
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'));
    `,
    ).run();

    const seeded = await seedUsersAndInvites(env.DB, eventId, ["holder@example.test", "organizer@example.test"]);

    await env.DB.prepare(
      `
      INSERT INTO event_participants (
        id, event_id, user_id, role, subrole, status, source_type, source_ref, created_at, updated_at
      ) VALUES (
        '${crypto.randomUUID()}', '${eventId}', '${seeded["organizer@example.test"].userId}',
        'organizer', NULL, 'active', 'system', 'seed', datetime('now'), datetime('now')
      );
    `,
    ).run();

    const event = await getEventBySlug(env.DB, "pqc-2026");

    await createRegistration(env.DB, {
      event,
      userId: seeded["holder@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["holder@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const organizer = await createRegistration(env.DB, {
      event,
      userId: seeded["organizer@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["organizer@example.test"].inviteId,
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const registration = (
      await queryAll<{ capacity_exempt_in_person: number; capacity_exempt_reason: string | null }>(
        env.DB,
        "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?",
        [organizer.registration.id],
      )
    )[0];

    expect(registration.capacity_exempt_in_person).toBe(1);
    expect(registration.capacity_exempt_reason).toBe("role:organizer");

    const dayWaitlist = (
      await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM event_day_waitlist_entries WHERE registration_id = ? AND status IN ('waiting', 'offered')",
        [organizer.registration.id],
      )
    )[0];

    expect(Number(dayWaitlist.total)).toBe(0);

    const [admin] = await queryAll<{ id: string; email: string }>(
      env.DB,
      "SELECT id, email FROM users WHERE role = 'admin' LIMIT 1",
    );
    await expect(
      updateAdminRegistrationDayAttendance(
        env.DB,
        { identityType: "user", id: admin.id, email: admin.email, role: "admin" },
        {
          eventSlug: event.slug,
          registrationId: organizer.registration.id,
          change: { action: "waitlist", dayDates: ["2026-12-01"] },
          appBaseUrl: "https://example.test",
        },
      ),
    ).rejects.toThrow(/role-based capacity-exempt attendee cannot be placed on the waitlist/);
  });
});
