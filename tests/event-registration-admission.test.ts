import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  admitRegistration as admitRegistrationService,
  createRegistration,
} from "../functions/_lib/services/registrations";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import app, { callApi } from "./helpers/app";
import { eventRegistrationAdmissionResponseSchema } from "../assets/shared/schemas/route-contracts-event-registration-management";

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
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    sourceType: "invite",
    inviteId: holderSeed.inviteId,
    confirmationTtlHours: 48,
    signingSecret: "test-signing-secret",
  });
  const vipRegistration = await createRegistration(env.DB, {
    event,
    userId: vipSeed.userId,
    dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
    sourceType: "invite",
    inviteId: vipSeed.inviteId,
    confirmationTtlHours: 48,
    signingSecret: "test-signing-secret",
  });
  return { adminToken, eventId, registrationId: vipRegistration.registration.id };
}

function admit(adminToken: string, registrationId: string, mode: string): Promise<Response> {
  return callApi(env as any, `/api/v1/events/pqc-2026/registrations/${registrationId}/admissions`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({ mode, reason: "Admitted from the waitlist", dayDates: ["2026-12-01"] }),
  });
}

describe("event-registration admission", () => {
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

    const response = await app.fetch(
      new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/admissions`, {
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
      env as any,
      { passThroughOnException() {}, waitUntil() {} } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const rawPayload = (await response.json()) as { registration: Record<string, unknown> };
    expect(rawPayload.registration).not.toHaveProperty("attendance_type");
    const admitPayload = eventRegistrationAdmissionResponseSchema.parse(rawPayload);
    expect(admitPayload.registration).toMatchObject({ id: registrationId, status: "registered" });
    expect(admitPayload.registration).not.toHaveProperty("confirmation_link_secret");
    expect(admitPayload.registration).not.toHaveProperty("manage_link_secret");
    expect(admitPayload.admittedDayDates).toEqual(["2026-12-01"]);

    const [registration] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM registrations WHERE id = ?", [
      registrationId,
    ]);
    expect(registration.id).toBe(registrationId);

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
      await queryAll<{ details_json: string }>(
        env.DB,
        "SELECT details_json FROM audit_log WHERE action = 'registration_admitted' AND entity_id = ?",
        [registrationId],
      )
    )[0];
    expect(JSON.parse(audit.details_json)).toMatchObject({
      capacityDecisions: {
        to: [{ dayDate: "2026-12-01", outcome: "admitted", reason: "admin:vip", limit: 1 }],
      },
    });

    const outbox = (
      await queryAll<{ template_key: string; payload_json: string }>(
        env.DB,
        "SELECT template_key, payload_json FROM email_outbox WHERE recipient_email = 'vip@example.test' ORDER BY created_at DESC LIMIT 1",
      )
    )[0];
    const payload = JSON.parse(outbox.payload_json) as {
      adminAdmitNotice?: boolean;
      attendanceSummary?: string;
      dayWaitlist?: unknown[];
      dayAttendance?: Array<{ statusLabel: string }>;
    };
    expect(outbox.template_key).toBe("registration_updated");
    expect(payload.adminAdmitNotice).toBe(false);
    expect(payload.attendanceSummary).toContain("Confirmed in-person attendance");
    expect(payload.dayWaitlist).toEqual([]);
    expect(payload.dayAttendance?.[0]?.statusLabel).toBe("Confirmed in-person attendance");
  });

  it("refuses a within-capacity admission on a full day and leaves the waitlist place untouched", async () => {
    const { adminToken, registrationId } = await seedWaitlistedVipScenario();

    const response = await admit(adminToken, registrationId, "within_capacity");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "DAY_CAPACITY_FULL" } });
    const [waitlist] = await queryAll<{ status: string }>(
      env.DB,
      "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = 'day-1'",
      [registrationId],
    );
    expect(waitlist.status).toBe("waiting");
  });

  it("admits within capacity only from the waiting list, never a lapsed or unlisted registration", async () => {
    const { adminToken, registrationId } = await seedWaitlistedVipScenario();
    await env.DB.prepare("UPDATE event_days SET in_person_capacity = 2 WHERE id = 'day-1'").run();
    await env.DB.prepare("DELETE FROM event_day_waitlist_entries WHERE registration_id = ?").bind(registrationId).run();

    const response = await admit(adminToken, registrationId, "within_capacity");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "REGISTRATION_DAY_NOT_WAITLISTED" } });
  });

  it("admits within capacity once a seat is free", async () => {
    const { adminToken, registrationId } = await seedWaitlistedVipScenario();
    await env.DB.prepare("UPDATE event_days SET in_person_capacity = 2 WHERE id = 'day-1'").run();

    const response = await admit(adminToken, registrationId, "within_capacity");

    expect(response.status).toBe(200);
    expect(eventRegistrationAdmissionResponseSchema.parse(await response.json()).admittedDayDates).toEqual([
      "2026-12-01",
    ]);
    await expect(
      queryAll(env.DB, "SELECT status, reason_code FROM event_day_waitlist_entries WHERE registration_id = ?", [
        registrationId,
      ]),
    ).resolves.toEqual([{ status: "accepted", reason_code: null }]);
  });

  it.each(["in_person", "interactive_stream"])(
    "honors configured %s capacity without a legacy limit",
    async (optionValue) => {
      const { adminToken, registrationId } = await seedWaitlistedVipScenario();
      const options = (capacity: number) =>
        JSON.stringify([
          {
            value: optionValue,
            label: "Selected attendance",
            accessMode: optionValue === "in_person" ? "physical" : "remote",
            capacity,
          },
        ]);
      await env.DB.prepare(
        "UPDATE event_days SET in_person_capacity = NULL, attendance_options_json = ? WHERE id = 'day-1'",
      )
        .bind(options(1))
        .run();
      await env.DB.prepare("UPDATE registration_day_attendance SET attendance_type = ? WHERE event_day_id = 'day-1'")
        .bind(optionValue)
        .run();
      const refused = await admit(adminToken, registrationId, "within_capacity");
      expect(refused.status).toBe(409);
      expect(await refused.json()).toMatchObject({ error: { code: "DAY_CAPACITY_FULL" } });
      await env.DB.prepare("UPDATE event_days SET attendance_options_json = ? WHERE id = 'day-1'")
        .bind(options(2))
        .run();
      expect((await admit(adminToken, registrationId, "within_capacity")).status).toBe(200);
    },
  );

  it("reserves a live offer for its holder and admits that holder without counting the offer twice", async () => {
    const { adminToken, registrationId } = await seedWaitlistedVipScenario();
    await env.DB.prepare("UPDATE event_days SET in_person_capacity = 2 WHERE id = 'day-1'").run();
    await env.DB.prepare(
      "UPDATE event_day_waitlist_entries SET status = 'offered', offer_expires_at = ? WHERE registration_id = ?",
    )
      .bind(new Date(Date.now() + 3600_000).toISOString(), registrationId)
      .run();
    expect((await admit(adminToken, registrationId, "within_capacity")).status).toBe(200);
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
      const response = await app.fetch(
        new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/admissions`, {
          method: "POST",
          headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
          body: JSON.stringify({ mode: "vip", reason: "Rollback proof", dayDates: ["2026-12-01"] }),
        }),
        env as any,
        { passThroughOnException() {}, waitUntil() {} } as unknown as ExecutionContext,
      );
      expect(response.status).toBe(500);

      const [registration] = await queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM registrations WHERE id = ?",
        [registrationId],
      );
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
      expect(registration).toEqual({ status: "registered" });
      expect(waitlist.status).toBe("waiting");
      expect(Number(audit.total)).toBe(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER reject_admission_email").run();
    }
  });

  it("treats an exact repeated admission as side-effect-free", async () => {
    const { adminToken, registrationId } = await seedWaitlistedVipScenario();
    const request = () =>
      app.fetch(
        new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/admissions`, {
          method: "POST",
          headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
          body: JSON.stringify({ mode: "vip", reason: "Retry proof", dayDates: ["2026-12-01"] }),
        }),
        env as any,
        { passThroughOnException() {}, waitUntil() {} } as unknown as ExecutionContext,
      );

    expect((await request()).status).toBe(200);
    const [afterFirst] = await queryAll<{ transition_revision: number }>(
      env.DB,
      "SELECT transition_revision FROM registrations WHERE id = ?",
      [registrationId],
    );
    expect((await request()).status).toBe(200);
    const [afterSecond] = await queryAll<{ transition_revision: number }>(
      env.DB,
      "SELECT transition_revision FROM registrations WHERE id = ?",
      [registrationId],
    );

    expect(afterSecond.transition_revision).toBe(afterFirst.transition_revision);
    await expect(
      queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'registration_admitted' AND entity_id = ?",
        [registrationId],
      ),
    ).resolves.toEqual([{ total: 1 }]);
    await expect(
      queryAll<{ total: number }>(
        env.DB,
        `SELECT COUNT(*) AS total FROM email_outbox
         WHERE template_key = 'registration_updated' AND recipient_email = 'vip@example.test'`,
      ),
    ).resolves.toEqual([{ total: 1 }]);
  });

  it("retries against current capacity when another person takes the last seat before admission commits", async () => {
    const { eventId, registrationId } = await seedWaitlistedVipScenario();
    await env.DB.prepare("UPDATE event_days SET in_person_capacity = 2 WHERE id = 'day-1'").run();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const contender = await seedInvite(env.DB, eventId, "last-seat@example.test");
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
    let raced = false;
    const racingDb = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("UPDATE registrations") && sql.includes("SET updated_at"),
      async () => {
        raced = true;
        const competing = await createRegistration(env.DB, {
          event,
          userId: contender.userId,
          dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
          sourceType: "invite",
          inviteId: contender.inviteId,
          signingSecret: "test-signing-secret",
        });
        await admitRegistrationService(env.DB, {
          registrationId: competing.registration.id,
          event,
          dayDates: ["2026-12-01"],
          mode: "within_capacity",
          reason: "Competing admission",
          actorUserId: admin.id,
          appBaseUrl: "https://app.test",
        });
      },
    );
    await expect(
      admitRegistrationService(racingDb, {
        registrationId,
        event,
        dayDates: ["2026-12-01"],
        mode: "within_capacity",
        reason: "Capacity race proof",
        actorUserId: admin.id,
        appBaseUrl: "https://app.test",
      }),
    ).rejects.toMatchObject({ status: 409, code: "DAY_CAPACITY_FULL" });
    expect(raced).toBe(true);
    await expect(
      queryAll(env.DB, "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ?", [registrationId]),
    ).resolves.toEqual([{ status: "waiting" }]);
    await expect(
      queryAll(
        env.DB,
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'registration_admitted' AND entity_id = ?",
        [registrationId],
      ),
    ).resolves.toEqual([{ total: 0 }]);
    await expect(
      queryAll(
        env.DB,
        "SELECT COUNT(*) AS total FROM email_outbox WHERE template_key = 'registration_updated' AND recipient_email = 'vip@example.test'",
      ),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("rejects a stale admission after an intervening registration transition", async () => {
    const { eventId, registrationId } = await seedWaitlistedVipScenario();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const [admin] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
    );
    const racingDb = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("UPDATE registrations") && sql.includes("SET updated_at"),
      () =>
        env.DB.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ? AND event_id = ?")
          .bind(registrationId, eventId)
          .run(),
    );
    const staleAdmission = admitRegistrationService(racingDb, {
      registrationId,
      event,
      dayDates: ["2026-12-01"],
      mode: "vip",
      reason: "Stale snapshot proof",
      actorUserId: admin.id,
      appBaseUrl: "https://app.test",
    });
    await expect(staleAdmission).rejects.toMatchObject({ status: 409, code: "REGISTRATION_CHANGED" });
    await expect(
      queryAll<{ status: string }>(
        env.DB,
        "SELECT status FROM event_day_waitlist_entries WHERE registration_id = ? AND event_day_id = 'day-1'",
        [registrationId],
      ),
    ).resolves.toEqual([{ status: "waiting" }]);
    await expect(
      queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'registration_admitted' AND entity_id = ?",
        [registrationId],
      ),
    ).resolves.toEqual([{ total: 0 }]);
  });
});
