import { describe, expect, it } from "vitest";
import { D1DatabaseShim } from "./helpers/d1-shim";
import { createContext, createEnv, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration } from "../functions/_lib/services/registrations";
import { onRequestPost as admitRegistration } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/admit";

async function seedInvite(db: D1DatabaseShim, eventId: string, email: string): Promise<{ userId: string; inviteId: string }> {
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

  return { userId, inviteId };
}

describe("admin VIP admit", () => {
  it("admits waitlisted day attendance as capacity exempt and logs audit", async () => {
    const db = new D1DatabaseShim();
    db.runMigrations();
    const { eventId } = await seedEventAndAdmin(db);
    const env = createEnv(db);

    await db.exec?.(`
      INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
      VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'));
    `);

    const adminId = db.raw<{ id: string }>("SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")[0].id;
    await createAdminSession(db, adminId, "admin-token");

    const holderSeed = await seedInvite(db, eventId, "holder@example.test");
    const vipSeed = await seedInvite(db, eventId, "vip@example.test");
    const event = await getEventBySlug(db, "pqc-2026");

    await createRegistration(db, {
      event,
      userId: holderSeed.userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: holderSeed.inviteId,
      confirmationTtlHours: 48,
    });

    const vipRegistration = await createRegistration(db, {
      event,
      userId: vipSeed.userId,
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "invite",
      inviteId: vipSeed.inviteId,
      confirmationTtlHours: 48,
    });

    const before = db.raw<{ status: string }>(
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = 'day-1'",
      [vipRegistration.registration.id],
    )[0];
    expect(before.status).toBe("waiting");

    const response = await admitRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/events/pqc-2026/registrations/x/admit", {
          method: "POST",
          headers: {
            authorization: "Bearer admin-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mode: "vip",
            reason: "Key sponsor guest",
            dayDates: ["2026-12-01"],
          }),
        }),
        { eventSlug: "pqc-2026", registrationId: vipRegistration.registration.id },
      ),
    );

    expect(response.status).toBe(200);

    const registration = db.raw<{ capacity_exempt_in_person: number; capacity_exempt_reason: string | null }>(
      "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?",
      [vipRegistration.registration.id],
    )[0];

    expect(registration.capacity_exempt_in_person).toBe(1);
    expect(registration.capacity_exempt_reason).toContain("vip:");

    const waitlist = db.raw<{ status: string }>(
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = 'day-1'",
      [vipRegistration.registration.id],
    )[0];
    expect(waitlist.status).toBe("removed");

    const audit = db.raw<{ total: number }>(
      "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'registration_admitted' AND entity_id = ?",
      [vipRegistration.registration.id],
    )[0];
    expect(Number(audit.total)).toBe(1);
  });
});
