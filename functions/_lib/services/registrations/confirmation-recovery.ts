import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { normalizeEmail } from "../../validation";
import type { EventRecord } from "../events";
import { verifyDatabaseCapability } from "../capability-links";
import { prepareRegistrationConfirmationEmail } from "./status-notifications";
import { REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL } from "./recipient-email";
import { isRegistrationTransitionConflict, prepareRegistrationTransitionGuard } from "./transition-guard";
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
    const normalizedEmail = normalizeEmail(payload.email);
    registration = await first<RegistrationRecord>(
      db,
      `SELECT ${registrationColumns("r")}
       FROM registrations r JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ? AND r.status = 'pending_email_confirmation'
         AND (
           u.normalized_email = ?
           OR (u.pending_email_change_registration_id = r.id
               AND u.pending_email = ?)
         )
       ORDER BY r.created_at DESC LIMIT 1`,
      [payload.event.id, normalizedEmail, normalizedEmail],
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
  const recipient = await first<{ email: string }>(
    db,
    `SELECT ${REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL} AS email
       FROM registrations r
       JOIN users u ON u.id = r.user_id
      WHERE r.id = ? AND u.id = ?`,
    [registration.id, registration.user_id],
  );
  if (!recipient) throw new AppError(500, "USER_NOT_FOUND", "Associated user record is missing");
  const email = await prepareRegistrationConfirmationEmail(db, {
    event: payload.event,
    registrationId: registration.id,
    registration,
    appBaseUrl: payload.appBaseUrl,
    confirmationTtlHours: payload.confirmationTtlHours,
    subject: `Confirm your registration for ${payload.event.name}`,
    recipientEmail: recipient.email,
  });
  try {
    await db.batch([
      prepareRegistrationTransitionGuard(db, registration),
      db
        .prepare(
          `UPDATE registrations SET confirmation_reminder_sent_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending_email_confirmation'`,
        )
        .bind(now, now, registration.id),
      email.statement,
    ]);
  } catch (error) {
    // Public recovery is deliberately non-enumerating. A concurrent lifecycle
    // change makes this recipient snapshot stale, so roll back the outbox and
    // return the same no-op result as an unmatched email address.
    if (isRegistrationTransitionConflict(error)) return null;
    throw error;
  }
  return { outboxId: email.outboxId };
}
