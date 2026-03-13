import { describe, expect, it } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { seedEventAndAdmin } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration, updateRegistrationByManageToken } from "../functions/_lib/services/registrations";

async function seedUsersAndInvites(db: D1DatabaseShim, eventId: string, emails: string[]): Promise<Record<string, { userId: string; inviteId: string }>> {
  const map: Record<string, { userId: string; inviteId: string }> = {};

  for (const email of emails) {
    const userId = crypto.randomUUID();
    const inviteId = crypto.randomUUID();

    await db.exec?.(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
      VALUES ('${userId}', '${email}', '${email}', 'User', '${email.split("@")[0]}', datetime('now'), datetime('now'));

      INSERT INTO invites (
        id, event_id, invitee_email, invite_type, token_hash, status, source_type, created_at
      ) VALUES (
        '${inviteId}', '${eventId}', '${email}', 'attendee', '${crypto.randomUUID().replaceAll("-", "")}', 'sent', 'direct', datetime('now')
      );
    `);

    map[email] = { userId, inviteId };
  }

  return map;
}

describe("day waitlist priorities", () => {
  it("promotes continuity lane before general lane", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);

    await db.exec?.(`
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES
        ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now')),
        ('day-2', '${eventId}', '2026-12-02', 'Day 2', 1, 20, datetime('now'), datetime('now'));
    `);

    const seeded = await seedUsersAndInvites(db, eventId, [
      "holder@example.test",
      "continuity@example.test",
      "general@example.test",
    ]);

    const event = await getEventBySlug(db, "pqc-2026");

    const holder = await createRegistration(db, {
      event,
      userId: seeded["holder@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["holder@example.test"].inviteId,
      confirmationTtlHours: 48,
    });

    const continuity = await createRegistration(db, {
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
    });

    const general = await createRegistration(db, {
      event,
      userId: seeded["general@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["general@example.test"].inviteId,
      confirmationTtlHours: 48,
    });

    const lanes = db.raw<{ registration_id: string; priority_lane: string }>(
      "SELECT registration_id, priority_lane FROM event_day_waitlist_entries WHERE event_day_id = 'day-1' ORDER BY position ASC",
    );
    expect(lanes).toHaveLength(2);
    expect(lanes.find((row) => row.registration_id === continuity.registration.id)?.priority_lane).toBe("continuity");
    expect(lanes.find((row) => row.registration_id === general.registration.id)?.priority_lane).toBe("general");

    await updateRegistrationByManageToken(db, {
      manageToken: holder.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
    });

    const statuses = db.raw<{ registration_id: string; status: string }>(
      "SELECT registration_id, status FROM event_day_waitlist_entries WHERE event_day_id = 'day-1'",
    );

    expect(statuses.find((row) => row.registration_id === continuity.registration.id)?.status).toBe("offered");
    expect(statuses.find((row) => row.registration_id === general.registration.id)?.status).toBe("waiting");
  });

  it("allows only one active offer per user across event days", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);

    await db.exec?.(`
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES
        ('d1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now')),
        ('d2', '${eventId}', '2026-12-02', 'Day 2', 1, 20, datetime('now'), datetime('now'));
    `);

    const seeded = await seedUsersAndInvites(db, eventId, [
      "holder-one@example.test",
      "holder-two@example.test",
      "multi@example.test",
      "backup@example.test",
    ]);

    const event = await getEventBySlug(db, "pqc-2026");

    const holderOne = await createRegistration(db, {
      event,
      userId: seeded["holder-one@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["holder-one@example.test"].inviteId,
      confirmationTtlHours: 48,
    });

    const holderTwo = await createRegistration(db, {
      event,
      userId: seeded["holder-two@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-02", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["holder-two@example.test"].inviteId,
      confirmationTtlHours: 48,
    });

    const multi = await createRegistration(db, {
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
    });

    const backup = await createRegistration(db, {
      event,
      userId: seeded["backup@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-02", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["backup@example.test"].inviteId,
      confirmationTtlHours: 48,
    });

    await updateRegistrationByManageToken(db, {
      manageToken: holderOne.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
    });

    await updateRegistrationByManageToken(db, {
      manageToken: holderTwo.manageToken,
      action: "cancel",
      waitlistClaimWindowHours: 24,
    });

    const multiStatuses = db.raw<{ event_day_id: string; status: string }>(
      "SELECT event_day_id, status FROM event_day_waitlist_entries WHERE registration_id = ? ORDER BY event_day_id",
      [multi.registration.id],
    );
    const backupStatuses = db.raw<{ event_day_id: string; status: string }>(
      "SELECT event_day_id, status FROM event_day_waitlist_entries WHERE registration_id = ? ORDER BY event_day_id",
      [backup.registration.id],
    );

    expect(multiStatuses.find((row) => row.event_day_id === "d1")?.status).toBe("offered");
    expect(multiStatuses.find((row) => row.event_day_id === "d2")?.status).toBe("waiting");
    expect(backupStatuses.find((row) => row.event_day_id === "d2")?.status).toBe("offered");
  });

  it("marks organizer registrations as capacity exempt", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);

    await db.exec?.(`
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'));
    `);

    const seeded = await seedUsersAndInvites(db, eventId, [
      "holder@example.test",
      "organizer@example.test",
    ]);

    await db.exec?.(`
      INSERT INTO event_participants (
        id, event_id, user_id, role, subrole, status, source_type, source_ref, created_at, updated_at
      ) VALUES (
        '${crypto.randomUUID()}', '${eventId}', '${seeded["organizer@example.test"].userId}',
        'organizer', NULL, 'active', 'system', 'seed', datetime('now'), datetime('now')
      );
    `);

    const event = await getEventBySlug(db, "pqc-2026");

    await createRegistration(db, {
      event,
      userId: seeded["holder@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["holder@example.test"].inviteId,
      confirmationTtlHours: 48,
    });

    const organizer = await createRegistration(db, {
      event,
      userId: seeded["organizer@example.test"].userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: seeded["organizer@example.test"].inviteId,
      confirmationTtlHours: 48,
    });

    const registration = db.raw<{ capacity_exempt_in_person: number; capacity_exempt_reason: string | null }>(
      "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?",
      [organizer.registration.id],
    )[0];

    expect(registration.capacity_exempt_in_person).toBe(1);
    expect(registration.capacity_exempt_reason).toBe("role:organizer");

    const dayWaitlist = db.raw<{ total: number }>(
      "SELECT COUNT(*) AS total FROM event_day_waitlist_entries WHERE registration_id = ? AND status IN ('waiting', 'offered')",
      [organizer.registration.id],
    )[0];

    expect(Number(dayWaitlist.total)).toBe(0);
  });
});
