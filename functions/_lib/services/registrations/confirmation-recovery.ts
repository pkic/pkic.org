import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { normalizeEmail } from "../../validation";
import type { EventRecord } from "../events";
import { verifyDatabaseCapability } from "../capability-links";
import { prepareRegistrationConfirmationEmail } from "./status-notifications";
import { REGISTRATION_COLUMNS, registrationColumns, type RegistrationRecord } from "./types";

export async function recoverRegistrationConfirmation(
  db: DatabaseLike,
  payload: {
    event: EventRecord;
    token?: string;
    registrationId?: string;
    email?: string;
    signingSecret: string;
    appBaseUrl: string;
    confirmationTtlHours: number;
  },
): Promise<{ outboxId: string } | null> {
  let registration: RegistrationRecord | null = null;
  if (payload.token) {
    const verified = await verifyDatabaseCapability({
      db,
      signingSecret: payload.signingSecret,
      purpose: "registration_confirm",
      token: payload.token,
    });
    if (verified.ok && (!payload.registrationId || payload.registrationId === verified.resourceId)) {
      registration = await first<RegistrationRecord>(
        db,
        `SELECT ${REGISTRATION_COLUMNS} FROM registrations
         WHERE id = ? AND event_id = ? AND status = 'pending_email_confirmation'`,
        [verified.resourceId, payload.event.id],
      );
    }
  }
  if (!registration && payload.email) {
    registration = await first<RegistrationRecord>(
      db,
      `SELECT ${registrationColumns("r")}
       FROM registrations r JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ? AND r.status = 'pending_email_confirmation' AND u.normalized_email = ?
       ORDER BY r.created_at DESC LIMIT 1`,
      [payload.event.id, normalizeEmail(payload.email)],
    );
  }
  if (!registration) {
    if (payload.email) return null;
    throw new AppError(
      404,
      "RESEND_TOKEN_INVALID",
      "No pending registration found for this token; it may already be confirmed.",
    );
  }

  const now = nowIso();
  const email = await prepareRegistrationConfirmationEmail(db, {
    event: payload.event,
    registrationId: registration.id,
    registration,
    appBaseUrl: payload.appBaseUrl,
    confirmationTtlHours: payload.confirmationTtlHours,
    subject: `Confirm your registration for ${payload.event.name}`,
  });
  await db.batch([
    db
      .prepare(
        `UPDATE registrations SET confirmation_reminder_sent_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending_email_confirmation'`,
      )
      .bind(now, now, registration.id),
    email.statement,
  ]);
  return { outboxId: email.outboxId };
}
