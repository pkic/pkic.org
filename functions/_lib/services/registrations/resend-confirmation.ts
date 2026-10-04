import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import type { EventRecord } from "../events";
import { firstReferralCodeQuerySql } from "../referral-code-projection";
import { userRecordColumns, type UserRecord } from "../users";
import { getRegistrationById } from "./queries";
import { REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL } from "./recipient-email";
import { prepareRegistrationConfirmationEmail, prepareRegistrationConfirmedEmail } from "./status-notifications";

export interface ResendRegistrationEmailPayload {
  registrationId: string;
  event: EventRecord;
  actorUserId: string;
  appBaseUrl: string;
  confirmationTtlHours: number;
  internalSigningSecret?: string;
  rsvpEmail?: string;
}

/** Commits the reminder marker, selected email intent, and audit in one D1 batch. */
export async function resendRegistrationEmail(
  db: DatabaseLike,
  payload: ResendRegistrationEmailPayload,
): Promise<{ outboxId: string }> {
  const registration = await getRegistrationById(db, payload.registrationId);
  if (registration.event_id !== payload.event.id) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  }
  if (registration.status === "cancelled") {
    throw new AppError(409, "REGISTRATION_CANCELLED", "Cannot resend email to a cancelled registration");
  }

  const now = nowIso();
  const statements: StatementLike[] = [];
  let email;
  if (registration.status === "pending_email_confirmation") {
    const user = await first<UserRecord & { confirmation_email: string }>(
      db,
      `SELECT ${userRecordColumns("u")},
              ${REGISTRATION_CONFIRMATION_RECIPIENT_EMAIL_SQL} AS confirmation_email
         FROM registrations r
         JOIN users u ON u.id = r.user_id
        WHERE r.id = ? AND u.id = ?`,
      [registration.id, registration.user_id],
    );
    if (!user) throw new AppError(500, "USER_NOT_FOUND", "Associated user not found");
    statements.push(
      db
        .prepare(
          `UPDATE registrations
           SET confirmation_reminder_sent_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending_email_confirmation'`,
        )
        .bind(now, now, registration.id),
    );
    email = await prepareRegistrationConfirmationEmail(db, {
      event: payload.event,
      registrationId: registration.id,
      registration,
      appBaseUrl: payload.appBaseUrl,
      recipientEmail: user.confirmation_email,
      confirmationTtlHours: payload.confirmationTtlHours,
      subject: `Confirm your registration for ${payload.event.name}`,
    });
  } else {
    const referral = await first<{ code: string }>(db, firstReferralCodeQuerySql("registration", "?"), [
      registration.id,
    ]);
    email = await prepareRegistrationConfirmedEmail(db, {
      event: payload.event,
      registrationId: registration.id,
      registration,
      appBaseUrl: payload.appBaseUrl,
      referralCode: referral?.code ?? null,
      internalSigningSecret: payload.internalSigningSecret,
      rsvpEmail: payload.rsvpEmail,
    });
  }

  statements.push(
    email.statement,
    prepareAuditLog(
      db,
      "admin",
      payload.actorUserId,
      "admin_registration_email_resent",
      "registration",
      registration.id,
      {
        eventId: payload.event.id,
        status: registration.status,
      },
    ),
  );
  await db.batch(statements);
  return { outboxId: email.outboxId };
}
