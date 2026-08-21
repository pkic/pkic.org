import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration } from "../functions/_lib/services/registrations";
import { onRequestPost as admitRegistration } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/admit";

async function seedInvite(
  _db: DatabaseLike,
  eventId: string,
  email: string,
): Promise<{ userId: string; inviteId: string }> {
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

  return { userId, inviteId };
}

async function seedWaitlistedVipScenario(): Promise<{
  adminToken: string;
  eventId: string;
  registrationId: string;
}> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  await env.DB.prepare(
    `INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
     VALUES ('day-1', ?, '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))`,
  )
    .bind(eventId)
    .run();
  const adminId = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0].id;
  const adminToken = await createAdminSession(env.DB, adminId, "admin-token");
  const holderSeed = await seedInvite(env.DB, eventId, "holder@example.test");
  const vipSeed = await seedInvite(env.DB, eventId, "vip@example.test");
  const event = await getEventBySlug(env.DB, "pqc-2026");
  await createRegistration(env.DB, {
    event,
    userId: holderSeed.userId,
    attendanceType: "in_person",
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    sourceType: "invite",
    inviteId: holderSeed.inviteId,
    confirmationTtlHours: 48,
    signingSecret: "test-signing-secret",
  });
  const vipRegistration = await createRegistration(env.DB, {
    event,
    userId: vipSeed.userId,
    attendanceType: "in_person",
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    sourceType: "invite",
    inviteId: vipSeed.inviteId,
    confirmationTtlHours: 48,
    signingSecret: "test-signing-secret",
  });
  return { adminToken, eventId, registrationId: vipRegistration.registration.id };
}

describe("admin VIP admit", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("admits only the selected waitlisted day beyond capacity and logs audit", async () => {
    const { adminToken, registrationId } = await seedWaitlistedVipScenario();

    const before = (
      await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = 'day-1'",
        [registrationId],
      )
    )[0];
    expect(before.status).toBe("waiting");

    const response = await admitRegistration(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/events/pqc-2026/registrations/x/admit", {
          method: "POST",
          headers: {
            authorization: `Bearer ${adminToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mode: "vip",
            reason: "Key sponsor guest",
            dayDates: ["2026-12-01"],
          }),
        }),
        { eventSlug: "pqc-2026", registrationId },
      ),
    );

    expect(response.status).toBe(200);

    const registration = (
      await queryAll<{ capacity_exempt_in_person: number; capacity_exempt_reason: string | null }>(
        env.DB,
        "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?",
        [registrationId],
      )
    )[0];

    expect(registration.capacity_exempt_in_person).toBe(0);
    expect(registration.capacity_exempt_reason).toBeNull();

    const waitlist = (
      await queryAll<{ status: string; reason_code: string; reason_note: string }>(
        env.DB,
        "SELECT status, reason_code, reason_note FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = 'day-1'",
        [registrationId],
      )
    )[0];
    expect(waitlist).toEqual({
      status: "accepted",
      reason_code: "admin_capacity_exempt",
      reason_note: "vip:Key sponsor guest",
    });

    const audit = (
      await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'registration_admitted' AND entity_id = ?",
        [registrationId],
      )
    )[0];
    expect(Number(audit.total)).toBe(1);

    const outbox = (
      await queryAll<{ template_key: string; payload_json: string }>(
        env.DB,
        "SELECT template_key, payload_json FROM email_outbox WHERE recipient_email = 'vip@example.test' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    const payload = JSON.parse(outbox.payload_json) as {
      adminAdmitNotice?: boolean;
      dayWaitlist?: unknown[];
      dayAttendance?: Array<{ statusLabel: string }>;
    };
    expect(outbox.template_key).toBe("registration_updated");
    expect(payload.adminAdmitNotice).toBe(true);
    expect(payload.dayWaitlist).toEqual([]);
    expect(payload.dayAttendance?.[0]?.statusLabel).toBe("Confirmed in-person attendance");
  });

  it("rolls back admission, waitlist, audit, and attendance when the durable email intent fails", async () => {
    const { adminToken, registrationId } = await seedWaitlistedVipScenario();
    await env.DB.prepare(
      `CREATE TRIGGER reject_admission_email
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'registration_updated'
       BEGIN
         SELECT RAISE(ABORT, 'forced admission email failure');
       END`,
    ).run();
    try {
      await expect(
        admitRegistration(
          createContext(
            env,
            new Request("https://app.test/api/v1/admin/events/pqc-2026/registrations/x/admit", {
              method: "POST",
              headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
              body: JSON.stringify({ mode: "vip", reason: "Rollback proof", dayDates: ["2026-12-01"] }),
            }),
            { eventSlug: "pqc-2026", registrationId },
          ),
        ),
      ).rejects.toThrow(/forced admission email failure/);

      const [registration] = await queryAll<{
        capacity_exempt_in_person: number;
        capacity_exempt_reason: string | null;
      }>(env.DB, "SELECT capacity_exempt_in_person, capacity_exempt_reason FROM registrations WHERE id = ?", [
        registrationId,
      ]);
      const [waitlist] = await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = 'day-1'",
        [registrationId],
      );
      const [audit] = await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'registration_admitted' AND entity_id = ?",
        [registrationId],
      );
      expect(registration).toEqual({ capacity_exempt_in_person: 0, capacity_exempt_reason: null });
      expect(waitlist.status).toBe("waiting");
      expect(Number(audit.total)).toBe(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_admission_email").run();
    }
  });
});
