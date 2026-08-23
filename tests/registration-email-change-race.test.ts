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
  updateRegistrationById,
} from "../functions/_lib/services/registrations";

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
          WHERE template_key = 'registration_confirm_email' AND recipient_email = ?`,
        ["race-new@example.com"],
      ),
    ).resolves.toEqual([{ total: 0 }]);
    await expect(
      queryAll<{ total: number }>(env.DB, "SELECT COUNT(*) AS total FROM audit_log WHERE action = ?", [
        "email_change_race_test",
      ]),
    ).resolves.toEqual([{ total: 0 }]);
  });
});
