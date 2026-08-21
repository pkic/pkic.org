import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration } from "../functions/_lib/services/registrations";
import { resendRegistrationEmail } from "../functions/_lib/services/registrations/resend-confirmation";

async function seedPendingRegistration(): Promise<{ registrationId: string; adminId: string }> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
     VALUES (?, 'resend@example.test', 'resend@example.test', 'Re', 'Send', datetime('now'), datetime('now'))`,
  )
    .bind(userId)
    .run();
  const event = await getEventBySlug(env.DB, "pqc-2026");
  const created = await createRegistration(env.DB, {
    event,
    userId,
    attendanceType: "virtual",
    sourceType: "open_registration",
    confirmationTtlHours: 48,
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
  });
  expect(created.registration.event_id).toBe(eventId);
  return { registrationId: created.registration.id, adminId: admin.id };
}

describe("admin registration email resend", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("commits the reminder marker, outbox email, and audit as one aggregate", async () => {
    const { registrationId, adminId } = await seedPendingRegistration();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const result = await resendRegistrationEmail(env.DB, {
      registrationId,
      event,
      actorUserId: adminId,
      appBaseUrl: "https://app.test",
      confirmationTtlHours: 48,
      internalSigningSecret: env.INTERNAL_SIGNING_SECRET,
    });

    const [registration] = await queryAll<{ confirmation_reminder_sent_at: string | null }>(
      env.DB,
      "SELECT confirmation_reminder_sent_at FROM registrations WHERE id = ?",
      registrationId,
    );
    expect(registration.confirmation_reminder_sent_at).not.toBeNull();
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          "SELECT COUNT(*) AS count FROM email_outbox WHERE id = ? AND template_key = 'registration_confirm_email'",
          result.outboxId,
        )
      )[0]?.count,
    ).toBe(1);
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'admin_registration_email_resent' AND entity_id = ?",
          registrationId,
        )
      )[0]?.count,
    ).toBe(1);
  });

  it("rolls back the marker and outbox if the audit write fails", async () => {
    const { registrationId, adminId } = await seedPendingRegistration();
    const event = await getEventBySlug(env.DB, "pqc-2026");
    await env.DB.prepare(
      `CREATE TRIGGER reject_registration_resend_audit
       BEFORE INSERT ON audit_log
       WHEN NEW.action = 'admin_registration_email_resent'
       BEGIN
         SELECT RAISE(ABORT, 'forced audit failure');
       END`,
    ).run();

    await expect(
      resendRegistrationEmail(env.DB, {
        registrationId,
        event,
        actorUserId: adminId,
        appBaseUrl: "https://app.test",
        confirmationTtlHours: 48,
        internalSigningSecret: env.INTERNAL_SIGNING_SECRET,
      }),
    ).rejects.toThrow("forced audit failure");

    const [registration] = await queryAll<{ confirmation_reminder_sent_at: string | null }>(
      env.DB,
      "SELECT confirmation_reminder_sent_at FROM registrations WHERE id = ?",
      registrationId,
    );
    expect(registration.confirmation_reminder_sent_at).toBeNull();
    expect(
      (
        await queryAll<{ count: number }>(
          env.DB,
          "SELECT COUNT(*) AS count FROM email_outbox WHERE template_key = 'registration_confirm_email' AND recipient_email = 'resend@example.test'",
        )
      )[0]?.count,
    ).toBe(0);
  });
});
