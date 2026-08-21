/**
 * Initiates an email change for a registration by storing the pending email
 * on the user record. Does not change the email until verified via confirmation token.
 *
 * Flow:
 * 1. Validate new email domain has MX records
 * 2. Pre-check that the target email is not "squatted" by another account
 *    that has no overlap with the current registration's event
 * 3. Store pending_email on user record with expiration
 * 4. Reset registration to pending_email_confirmation
 * 5. Generate confirmation token
 * 6. On verification, email is finalized and accounts soft-merged if needed
 */

import { AppError } from "../../errors";
import { first, run } from "../../db/queries";
import { normalizeEmail } from "../../validation";
import { nowIso, addHours } from "../../utils/time";
import { checkEmailDomainMx } from "../../email/mx-check";
import type { DatabaseLike, StatementLike } from "../../types";
import { REGISTRATION_COLUMNS, type RegistrationRecord } from "./types";
import { newCapabilityLinkSecret, signedOrQueuedCapability } from "../capability-links";
import { prepareAuditLog } from "../audit";
import { prepareRegistrationConfirmationEmail, type RegistrationConfirmationEmailParams } from "./status-notifications";

const PENDING_CONFIRMATION_DEADLINE_HOURS = 14 * 24;

export interface ChangeEmailResult {
  registration: RegistrationRecord;
  userId: string;
  confirmationToken: string;
  previousEmail: string;
  pendingEmail: string;
  outboxId: string | null;
}

export interface ChangeRegistrationEmailParams {
  registrationId: string;
  newEmail: string;
  confirmationTtlHours: number;
  signingSecret?: string;
  /** Admin recovery may reactivate a cancelled registration. */
  allowCancelled?: boolean;
  auditActor?: { type: "admin" | "user"; id: string; action: string; eventId?: string };
  confirmationEmail?: Omit<RegistrationConfirmationEmailParams, "registrationId" | "recipientEmail" | "registration">;
  /** Planned state supplied by a caller composing one larger D1 batch. */
  registrationOverride?: RegistrationRecord;
}

export interface PreparedRegistrationEmailChange extends ChangeEmailResult {
  statements: StatementLike[];
}

/**
 * Initiates an email change by setting pending_email on the user.
 * The email is not finalized until confirmed via token verification.
 */
export async function prepareRegistrationEmailChange(
  db: DatabaseLike,
  params: ChangeRegistrationEmailParams,
): Promise<PreparedRegistrationEmailChange> {
  const registration =
    params.registrationOverride ??
    (await first<RegistrationRecord>(db, `SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = ?`, [
      params.registrationId,
    ]));
  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  }

  if (!params.allowCancelled && registration.status === "cancelled") {
    throw new AppError(409, "ALREADY_CANCELLED", "Cannot change email on a cancelled registration");
  }

  // Fetch current user
  const currentUser = await first<{
    id: string;
    email: string;
    normalized_email: string;
  }>(db, "SELECT id, email, normalized_email FROM users WHERE id = ?", [registration.user_id]);
  if (!currentUser) {
    throw new AppError(500, "USER_NOT_FOUND", "Associated user record is missing");
  }

  const newNormalized = normalizeEmail(params.newEmail);
  if (newNormalized === currentUser.normalized_email) {
    throw new AppError(400, "EMAIL_UNCHANGED", "The new email address is the same as the current one");
  }

  // Verify the new email domain has MX records.
  const mxResult = await checkEmailDomainMx(newNormalized);
  if (!mxResult.hasMxRecords) {
    throw new AppError(
      422,
      "EMAIL_DOMAIN_INVALID",
      "The email domain does not appear to accept mail. Please check the address and try again.",
    );
  }

  // Pre-check: prevent squatting. If another (non-merged) user already owns
  // this email, the only legitimate confirmation outcome is a soft-merge --
  // and that requires the other account to also have a registration for this
  // same event. Otherwise reject up-front instead of leaving a dangling
  // pending_email that will fail at confirmation time.
  const conflictingUser = await first<{
    id: string;
    merged_into_user_id: string | null;
  }>(
    db,
    `SELECT id, merged_into_user_id
       FROM users
      WHERE normalized_email = ? AND id != ?`,
    [newNormalized, currentUser.id],
  );

  if (conflictingUser && conflictingUser.merged_into_user_id === null) {
    const sameEventReg = await first<{ id: string }>(
      db,
      `SELECT id FROM registrations WHERE event_id = ? AND user_id = ? LIMIT 1`,
      [registration.event_id, conflictingUser.id],
    );
    if (!sameEventReg) {
      throw new AppError(409, "EMAIL_TAKEN", "This email address is already in use by another account");
    }
  }

  // Also block stealing another user's pending_email reservation.
  const conflictingPending = await first<{ id: string }>(
    db,
    `SELECT id FROM users WHERE pending_email IS NOT NULL AND id != ?
       AND lower(pending_email) = lower(?)`,
    [currentUser.id, newNormalized],
  );
  if (conflictingPending) {
    throw new AppError(409, "EMAIL_TAKEN", "This email address is currently being claimed by another account");
  }

  const now = nowIso();
  const confirmationLinkSecret = newCapabilityLinkSecret();
  const confirmationDeadlineAt = addHours(now, PENDING_CONFIRMATION_DEADLINE_HOURS);
  const pendingEmailExpiresAt = addHours(now, params.confirmationTtlHours);

  // Store the normalized form so confirmation logic and the unique index see
  // a canonical value (raw user input is preserved on the registration trail
  // via audit logs / outgoing email).
  const pendingEmailToStore = newNormalized;

  const confirmationToken = await signedOrQueuedCapability({
    signingSecret: params.signingSecret,
    linkSecret: confirmationLinkSecret,
    purpose: "registration_confirm",
    resourceId: registration.id,
    ttlSeconds: params.confirmationTtlHours * 60 * 60,
  });
  // The user reservation and registration state are one aggregate change.
  // Generate the capability before committing so a signing/configuration
  // failure cannot leave a pending change that the caller never received.
  const statements: StatementLike[] = [
    db
      .prepare(
        `UPDATE users
         SET pending_email = ?, pending_email_expires_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(pendingEmailToStore, pendingEmailExpiresAt, now, currentUser.id),
    db
      .prepare(
        `UPDATE registrations
         SET status = 'pending_email_confirmation',
             confirmation_link_secret = ?,
             pending_confirmation_deadline_at = ?,
             confirmation_reminder_sent_at = NULL,
             confirmed_at = NULL,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(confirmationLinkSecret, confirmationDeadlineAt, now, registration.id),
  ];
  if (params.auditActor) {
    statements.push(
      prepareAuditLog(
        db,
        params.auditActor.type,
        params.auditActor.id,
        params.auditActor.action,
        "registration",
        registration.id,
        {
          ...(params.auditActor.eventId ? { eventId: params.auditActor.eventId } : {}),
          previousEmail: currentUser.email,
          newEmail: pendingEmailToStore,
        },
      ),
    );
  }
  const updated: RegistrationRecord = {
    ...registration,
    status: "pending_email_confirmation",
    confirmation_link_secret: confirmationLinkSecret,
    pending_confirmation_deadline_at: confirmationDeadlineAt,
    confirmed_at: null,
    updated_at: now,
  };
  const preparedEmail = params.confirmationEmail
    ? await prepareRegistrationConfirmationEmail(db, {
        ...params.confirmationEmail,
        registrationId: registration.id,
        recipientEmail: pendingEmailToStore,
        registration: updated,
      })
    : null;
  if (preparedEmail) statements.push(preparedEmail.statement);
  return {
    registration: updated,
    userId: currentUser.id,
    confirmationToken,
    previousEmail: currentUser.email,
    pendingEmail: pendingEmailToStore,
    outboxId: preparedEmail?.outboxId ?? null,
    statements,
  };
}

export async function changeRegistrationEmail(
  db: DatabaseLike,
  params: ChangeRegistrationEmailParams,
): Promise<ChangeEmailResult> {
  const prepared = await prepareRegistrationEmailChange(db, params);
  await db.batch(prepared.statements);
  const { statements: _statements, ...result } = prepared;
  return result;
}

interface FinalizeEmailChangeResult {
  registration: RegistrationRecord;
  mergedWithRegistrationId: string | null;
  mergedFromUserId: string | null;
  finalEmail: string;
}

export interface PreparedFinalizeEmailChange extends FinalizeEmailChangeResult {
  statements: StatementLike[];
}

/**
 * Finalizes an email change after token verification.
 *
 * Handles:
 * - Expired pending email (clears it)
 * - Conflict detection (another user already has this email)
 * - Soft account merge if the pending email belongs to another account that
 *   also holds a registration for the same event:
 *     * the other account's same-event registration is cancelled
 *     * its registrations for OTHER events are re-pointed to the surviving
 *       user where doing so does not violate UNIQUE(event_id, user_id)
 *     * the loser account is anonymized with a sentinel email and tagged
 *       via merged_into_user_id so audit trails stay navigable
 *
 * All mutations run in a single db.batch() for atomicity.
 */
export async function prepareFinalizeEmailChange(
  db: DatabaseLike,
  params: {
    userId: string;
    eventId: string;
    registrationId: string;
  },
): Promise<PreparedFinalizeEmailChange> {
  const now = nowIso();

  // Verify registration binding before mutating anything.
  const registrationBefore = await first<RegistrationRecord>(
    db,
    `SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = ?`,
    [params.registrationId],
  );
  if (!registrationBefore) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  }
  if (registrationBefore.event_id !== params.eventId) {
    throw new AppError(409, "EVENT_MISMATCH", "Registration does not belong to the expected event");
  }
  if (registrationBefore.user_id !== params.userId) {
    throw new AppError(409, "USER_MISMATCH", "Registration does not belong to the expected user");
  }

  // Fetch user with pending email
  const user = await first<{
    id: string;
    email: string;
    normalized_email: string;
    pending_email: string | null;
    pending_email_expires_at: string | null;
  }>(db, "SELECT id, email, normalized_email, pending_email, pending_email_expires_at FROM users WHERE id = ?", [
    params.userId,
  ]);

  if (!user || !user.pending_email) {
    throw new AppError(400, "NO_PENDING_EMAIL", "No pending email change found for this user");
  }

  // Check expiration
  if (user.pending_email_expires_at && user.pending_email_expires_at < now) {
    // Clear expired pending email
    await run(db, "UPDATE users SET pending_email = NULL, pending_email_expires_at = NULL WHERE id = ?", [user.id]);
    throw new AppError(410, "PENDING_EMAIL_EXPIRED", "Email confirmation link has expired");
  }

  const newNormalized = normalizeEmail(user.pending_email);

  // Identify any existing live (non-merged) account that owns this email.
  const conflictingUser = await first<{
    id: string;
    email: string;
    merged_into_user_id: string | null;
  }>(db, `SELECT id, email, merged_into_user_id FROM users WHERE normalized_email = ? AND id != ?`, [
    newNormalized,
    user.id,
  ]);

  let otherRegistration: { id: string; user_id: string; status: string } | null = null;
  if (conflictingUser && conflictingUser.merged_into_user_id === null) {
    otherRegistration = await first<{
      id: string;
      user_id: string;
      status: string;
    }>(
      db,
      `SELECT id, user_id, status FROM registrations
        WHERE event_id = ? AND user_id = ? AND id != ? LIMIT 1`,
      [params.eventId, conflictingUser.id, params.registrationId],
    );

    if (!otherRegistration) {
      // Another live account owns this email but has no same-event registration
      // -- not a valid merge scenario. Surface a recoverable failure.
      throw new AppError(409, "EMAIL_TAKEN", "This email address is already in use");
    }
  }

  const stmts: StatementLike[] = [];
  let mergedWithRegistrationId: string | null = null;
  let mergedFromUserId: string | null = null;

  if (otherRegistration && conflictingUser) {
    mergedWithRegistrationId = otherRegistration.id;
    mergedFromUserId = conflictingUser.id;

    // 1. Cancel the loser's same-event registration so the surviving user can
    //    own the only live registration for this event.
    stmts.push(
      db
        .prepare(`UPDATE registrations SET status = 'cancelled', updated_at = ? WHERE id = ?`)
        .bind(now, otherRegistration.id),
    );

    // 2. Re-point the loser's OTHER-event registrations to the surviving
    //    user, but only where the survivor doesn't already have a registration
    //    for that event (UNIQUE(event_id, user_id) would block it). Conflicting
    //    same-event rows are left attached to the (soon to be anonymized)
    //    loser so audit history is preserved.
    stmts.push(
      db
        .prepare(
          `UPDATE registrations
              SET user_id = ?, updated_at = ?
            WHERE user_id = ?
              AND event_id NOT IN (SELECT event_id FROM registrations WHERE user_id = ?)`,
        )
        .bind(user.id, now, conflictingUser.id, user.id),
    );

    // 3. Anonymize the loser to free up its normalized_email and tag it as
    //    merged. Use the loser's own id as sentinel suffix -- guaranteed unique.
    const sentinel = `merged-${conflictingUser.id}@deleted.invalid`;
    stmts.push(
      db
        .prepare(
          `UPDATE users
              SET email = ?, normalized_email = ?, merged_into_user_id = ?,
                  pending_email = NULL, pending_email_expires_at = NULL,
                  updated_at = ?
            WHERE id = ?`,
        )
        .bind(sentinel, normalizeEmail(sentinel), user.id, now, conflictingUser.id),
    );
  }

  // 4. Promote the pending email to the surviving user's canonical email.
  stmts.push(
    db
      .prepare(
        `UPDATE users
            SET email = ?, normalized_email = ?,
                pending_email = NULL, pending_email_expires_at = NULL,
                updated_at = ?
          WHERE id = ?`,
      )
      .bind(user.pending_email, newNormalized, now, user.id),
  );

  return {
    registration: registrationBefore,
    mergedWithRegistrationId,
    mergedFromUserId,
    finalEmail: user.pending_email,
    statements: stmts,
  };
}

export async function finalizeEmailChange(
  db: DatabaseLike,
  params: {
    userId: string;
    eventId: string;
    registrationId: string;
  },
): Promise<FinalizeEmailChangeResult> {
  const prepared = await prepareFinalizeEmailChange(db, params);
  await db.batch(prepared.statements);
  const registration = await first<RegistrationRecord>(
    db,
    `SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = ?`,
    [params.registrationId],
  );
  if (!registration) {
    throw new AppError(500, "REGISTRATION_NOT_FOUND", "Registration not found after email change");
  }
  return {
    registration,
    mergedWithRegistrationId: prepared.mergedWithRegistrationId,
    mergedFromUserId: prepared.mergedFromUserId,
    finalEmail: prepared.finalEmail,
  };
}
