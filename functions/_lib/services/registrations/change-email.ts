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
import { randomToken, sha256Hex } from "../../utils/crypto";
import { nowIso, addHours } from "../../utils/time";
import { checkEmailDomainMx } from "../../email/mx-check";
import type { DatabaseLike, StatementLike } from "../../types";
import type { RegistrationRecord } from "./types";

const PENDING_CONFIRMATION_DEADLINE_HOURS = 14 * 24;

interface ChangeEmailResult {
  registration: RegistrationRecord;
  userId: string;
  confirmationToken: string;
  previousEmail: string;
  pendingEmail: string;
}

/**
 * Initiates an email change by setting pending_email on the user.
 * The email is not finalized until confirmed via token verification.
 */
export async function changeRegistrationEmail(
  db: DatabaseLike,
  params: {
    registrationId: string;
    newEmail: string;
    confirmationTtlHours: number;
    /**
     * When true, allows changing the email on a cancelled registration and
     * resets its status to pending_email_confirmation. Intended for admin use
     * only so operators can recover bounce-cancelled registrations.
     */
    allowCancelled?: boolean;
  },
): Promise<ChangeEmailResult> {
  const registration = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [
    params.registrationId,
  ]);
  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  }

  if (
    !params.allowCancelled &&
    (registration.status === "cancelled" || registration.status === "cancelled_unauthorized")
  ) {
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
  const confirmationToken = randomToken(24);
  const confirmationTokenHash = await sha256Hex(confirmationToken);
  const confirmationDeadlineAt = addHours(now, PENDING_CONFIRMATION_DEADLINE_HOURS);
  const pendingEmailExpiresAt = addHours(now, params.confirmationTtlHours);

  // Store the normalized form so confirmation logic and the unique index see
  // a canonical value (raw user input is preserved on the registration trail
  // via audit logs / outgoing email).
  const pendingEmailToStore = newNormalized;

  // Store pending email on user record (doesn't violate UNIQUE constraint
  // on users.normalized_email; the dedicated pending_email index is checked).
  await run(
    db,
    `UPDATE users 
     SET pending_email = ?, pending_email_expires_at = ?, updated_at = ?
     WHERE id = ?`,
    [pendingEmailToStore, pendingEmailExpiresAt, now, currentUser.id],
  );

  // Reset registration to pending confirmation with new token
  await run(
    db,
    `UPDATE registrations
     SET status = 'pending_email_confirmation',
         confirmation_token_hash = ?,
         confirmation_token_expires_at = ?,
         pending_confirmation_deadline_at = ?,
         confirmation_reminder_sent_at = NULL,
         confirmed_at = NULL,
         updated_at = ?
     WHERE id = ?`,
    [confirmationTokenHash, null, confirmationDeadlineAt, now, registration.id],
  );

  const updated = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [registration.id]);
  if (!updated) {
    throw new AppError(500, "EMAIL_CHANGE_FAILED", "Failed to update registration");
  }

  return {
    registration: updated,
    userId: currentUser.id,
    confirmationToken,
    previousEmail: currentUser.email,
    pendingEmail: pendingEmailToStore,
  };
}

interface FinalizeEmailChangeResult {
  registration: RegistrationRecord;
  mergedWithRegistrationId: string | null;
  mergedFromUserId: string | null;
  finalEmail: string;
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
export async function finalizeEmailChange(
  db: DatabaseLike,
  params: {
    userId: string;
    eventId: string;
    registrationId: string;
  },
): Promise<FinalizeEmailChangeResult> {
  const now = nowIso();

  // Verify registration binding before mutating anything.
  const registrationBefore = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [
    params.registrationId,
  ]);
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

  await db.batch(stmts);

  const registration = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [
    params.registrationId,
  ]);

  if (!registration) {
    throw new AppError(500, "REGISTRATION_NOT_FOUND", "Registration not found after email change");
  }

  return {
    registration,
    mergedWithRegistrationId,
    mergedFromUserId,
    finalEmail: user.pending_email,
  };
}
