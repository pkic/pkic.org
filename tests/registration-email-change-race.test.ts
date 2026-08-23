import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { findOrCreateUser } from "../functions/_lib/services/users";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  changeRegistrationEmail,
  confirmRegistrationByToken,
  createRegistration,
  finalizeEmailChange,
  updateRegistrationById,
} from "../functions/_lib/services/registrations";
import { prepareRotateUserRegistrationManageSecrets } from "../functions/_lib/services/registrations/manage-capability-revocation";

describe("registration email-change concurrency", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("atomically rejects a prepared email change after the registration is cancelled", async () => {
    const signingSecret = "test-signing-secret";
    const { eventId } = await seedEventAndAdmin(env.DB);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const user = await findOrCreateUser(env.DB, { email: "race-original@example.com" });
    const created = await createRegistration(env.DB, {
      event,
      userId: user.id,
      attendanceType: "virtual",
      sourceType: "web",
      confirmationTtlHours: 24,
      signingSecret,
    });
    await confirmRegistrationByToken(env.DB, {
      token: created.confirmationToken!,
      waitlistClaimWindowHours: 24,
      signingSecret,
    });

    const gate = gateNextBatch(env.DB);
    const staleChange = changeRegistrationEmail(gate.db, {
      registrationId: created.registration.id,
      newEmail: "race-new@example.com",
      authority: { kind: "event_manager", actorUserId: created.registration.user_id },
      confirmationTtlHours: 24,
      signingSecret,
      auditActor: {
        type: "user",
        id: user.id,
        action: "email_change_race_test",
        eventId,
      },
      confirmationEmail: {
        event,
        appBaseUrl: "https://app.test",
        confirmationTtlHours: 24,
      },
    });
    await gate.reached;

    await updateRegistrationById(
      env.DB,
      { eventId, registrationId: created.registration.id, action: "cancel" },
      "admin",
    );
    gate.release();

    await expect(staleChange).rejects.toMatchObject({ status: 409, code: "REGISTRATION_CHANGED" });
    await expect(
      queryAll<{
        status: string;
        confirmation_link_secret: string | null;
        pending_confirmation_deadline_at: string | null;
      }>(
        env.DB,
        `SELECT status, confirmation_link_secret, pending_confirmation_deadline_at
           FROM registrations WHERE id = ?`,
        [created.registration.id],
      ),
    ).resolves.toEqual([
      {
        status: "cancelled",
        confirmation_link_secret: null,
        pending_confirmation_deadline_at: null,
      },
    ]);
    await expect(
      queryAll<{
        pending_email: string | null;
        pending_email_expires_at: string | null;
        pending_email_change_registration_id: string | null;
      }>(
        env.DB,
        `SELECT pending_email, pending_email_expires_at, pending_email_change_registration_id
           FROM users WHERE id = ?`,
        [user.id],
      ),
    ).resolves.toEqual([
      {
        pending_email: null,
        pending_email_expires_at: null,
        pending_email_change_registration_id: null,
      },
    ]);
    await expect(
      queryAll<{ total: number }>(
        env.DB,
        `SELECT COUNT(*) AS total FROM email_outbox
          WHERE template_key = 'registration_email_change' AND recipient_email = ?`,
        ["race-original@example.com"],
      ),
    ).resolves.toEqual([{ total: 0 }]);
    await expect(
      queryAll<{ total: number }>(env.DB, "SELECT COUNT(*) AS total FROM audit_log WHERE action = ?", [
        "email_change_race_test",
      ]),
    ).resolves.toEqual([{ total: 0 }]);
  });

  it("rolls back canonical promotion when the pending-email request changed after planning", async () => {
    const signingSecret = "test-signing-secret";
    const { eventId } = await seedEventAndAdmin(env.DB);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const user = await findOrCreateUser(env.DB, { email: "promotion-race-original@example.com" });
    const created = await createRegistration(env.DB, {
      event,
      userId: user.id,
      attendanceType: "virtual",
      sourceType: "web",
      confirmationTtlHours: 24,
      signingSecret,
    });
    const before = (
      await queryAll<{ manage_link_secret: string }>(
        env.DB,
        "SELECT manage_link_secret FROM registrations WHERE id = ?",
        [created.registration.id],
      )
    )[0];
    if (!before) throw new Error("Expected registration manage secret");
    await env.DB.prepare(
      `UPDATE users
            SET pending_email = 'promotion-race-new@example.com',
                pending_email_expires_at = datetime('now', '+1 day'),
                pending_email_change_registration_id = ?
          WHERE id = ?`,
    )
      .bind(created.registration.id, user.id)
      .run();

    const gate = gateNextBatch(env.DB);
    const promotion = finalizeEmailChange(gate.db, {
      userId: user.id,
      eventId,
      registrationId: created.registration.id,
    });
    await gate.reached;
    await env.DB.prepare(
      `UPDATE users
            SET pending_email = NULL, pending_email_expires_at = NULL,
                pending_email_change_registration_id = NULL
          WHERE id = ?`,
    )
      .bind(user.id)
      .run();
    gate.release();

    await expect(promotion).rejects.toMatchObject({ status: 409, code: "REGISTRATION_CHANGED" });
    await expect(
      queryAll<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", [user.id]),
    ).resolves.toEqual([{ email: "promotion-race-original@example.com" }]);
    await expect(
      queryAll<{ manage_link_secret: string }>(env.DB, "SELECT manage_link_secret FROM registrations WHERE id = ?", [
        created.registration.id,
      ]),
    ).resolves.toEqual([{ manage_link_secret: before.manage_link_secret }]);
  });

  it("rotates a sibling capability that changes after revocation is planned", async () => {
    const signingSecret = "test-signing-secret";
    const { eventId } = await seedEventAndAdmin(env.DB);
    const secondEventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events
         (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
       VALUES (?, ?, 'Second event', 'Europe/Amsterdam', 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
    )
      .bind(secondEventId, `second-${secondEventId}`)
      .run();
    const user = await findOrCreateUser(env.DB, { email: "sibling-race@example.com" });
    const first = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: user.id,
      attendanceType: "virtual",
      sourceType: "web",
      confirmationTtlHours: 24,
      signingSecret,
    });
    const sibling = await createRegistration(env.DB, {
      event: { id: secondEventId },
      userId: user.id,
      attendanceType: "virtual",
      sourceType: "web",
      confirmationTtlHours: 24,
      signingSecret,
    });

    const planned = prepareRotateUserRegistrationManageSecrets(
      env.DB,
      user.id,
      new Date().toISOString(),
      first.registration.id,
    );
    const concurrentSecret = "concurrently-rotated-secret";
    await env.DB.prepare("UPDATE registrations SET manage_link_secret = ? WHERE id = ?")
      .bind(concurrentSecret, sibling.registration.id)
      .run();
    await planned.run();

    await expect(
      queryAll<{ id: string; manage_link_secret: string }>(
        env.DB,
        "SELECT id, manage_link_secret FROM registrations WHERE id IN (?, ?) ORDER BY id",
        [first.registration.id, sibling.registration.id],
      ),
    ).resolves.toEqual(
      [
        { id: first.registration.id, manage_link_secret: first.registration.manage_link_secret },
        { id: sibling.registration.id, manage_link_secret: expect.not.stringMatching(concurrentSecret) },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });

  it("allows only one account to reserve a pending login email across concurrent batches", async () => {
    const signingSecret = "test-signing-secret";
    await seedEventAndAdmin(env.DB);
    const event = await getEventBySlug(env.DB, "pqc-2026");
    const firstUser = await findOrCreateUser(env.DB, { email: "race-first@example.com" });
    const secondUser = await findOrCreateUser(env.DB, { email: "race-second@example.com" });
    const firstRegistration = await createRegistration(env.DB, {
      event,
      userId: firstUser.id,
      attendanceType: "virtual",
      sourceType: "web",
      confirmationTtlHours: 24,
      signingSecret,
    });
    const secondRegistration = await createRegistration(env.DB, {
      event,
      userId: secondUser.id,
      attendanceType: "virtual",
      sourceType: "web",
      confirmationTtlHours: 24,
      signingSecret,
    });

    const gate = gateNextBatch(env.DB);
    const staleReservation = changeRegistrationEmail(gate.db, {
      registrationId: firstRegistration.registration.id,
      newEmail: "race-target@example.com",
      authority: { kind: "event_manager", actorUserId: firstRegistration.registration.user_id },
      confirmationTtlHours: 24,
      signingSecret,
    });
    await gate.reached;
    await changeRegistrationEmail(env.DB, {
      registrationId: secondRegistration.registration.id,
      newEmail: "race-target@example.com",
      authority: { kind: "event_manager", actorUserId: secondRegistration.registration.user_id },
      confirmationTtlHours: 24,
      signingSecret,
    });
    gate.release();

    await expect(staleReservation).rejects.toMatchObject({ status: 409, code: "EMAIL_TAKEN" });
    await expect(
      queryAll<{ email: string; pending_email: string | null }>(
        env.DB,
        "SELECT email, pending_email FROM users WHERE id IN (?, ?) ORDER BY email",
        [firstUser.id, secondUser.id],
      ),
    ).resolves.toEqual([
      { email: "race-first@example.com", pending_email: null },
      { email: "race-second@example.com", pending_email: "race-target@example.com" },
    ]);
  }, 15_000);
});
