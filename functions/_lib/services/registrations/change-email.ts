/**
 * Initiates an email change for a registration by storing the pending email
 * on the user record. Does not change the email until verified via confirmation token.
 *
 * Flow:
 * 1. Validate new email domain has MX records
 * 2. Pre-check that the target email is not reserved by another account
 * 3. Store pending_email on user record with expiration
 * 4. Reset registration to pending_email_confirmation
 * 5. Send an authorization token to the current login address
 * 6. After current-address approval, send a fresh token to the new address
 * 7. Only after both proofs, promote the new canonical login address
 */

import { AppError } from "../../errors";
import { first, run } from "../../db/queries";
import { normalizeEmail } from "../../validation";
import { nowIso, addHours } from "../../utils/time";
import { checkEmailDomainMx } from "../../email/mx-check";
import type { DatabaseLike, StatementLike } from "../../types";
import { REGISTRATION_COLUMNS, type RegistrationRecord } from "./types";
import { newCapabilityLinkSecret, signedOrQueuedCapability } from "../capability-links";
import { isAuditOneChangeGuardFailure, prepareAuditLog, prepareAuditLogAfterOneChange } from "../audit";
import { prepareRegistrationConfirmationEmail, type RegistrationConfirmationEmailParams } from "./status-notifications";
import { emailTakenError, findUserEmailOwner, isEmailReservationConflict } from "../user-emails";
import {
  isRegistrationTransitionConflict,
  prepareRegistrationTransitionGuard,
  registrationChangedError,
} from "./transition-guard";

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
  /** Planned state supplied by a caller whose larger D1 batch owns the transition guard. */
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
    pending_email: string | null;
    pending_email_change_registration_id: string | null;
  }>(
    db,
    `SELECT id, email, normalized_email, pending_email, pending_email_change_registration_id
       FROM users WHERE id = ?`,
    [registration.user_id],
  );
  if (!currentUser) {
    throw new AppError(500, "USER_NOT_FOUND", "Associated user record is missing");
  }

  const newNormalized = normalizeEmail(params.newEmail);
  if (newNormalized === currentUser.normalized_email) {
    throw new AppError(400, "EMAIL_UNCHANGED", "The new email address is the same as the current one");
  }
  if (currentUser.pending_email) {
    throw new AppError(409, "EMAIL_CHANGE_PENDING", "An email change is already awaiting verification");
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

  // Confirming control of an email does not prove two accounts represent the
  // same person. Never turn an email change into an implicit identity merge.
  const emailOwner = await findUserEmailOwner(db, newNormalized);
  if (emailOwner && emailOwner.userId !== currentUser.id) {
    if (emailOwner.kind === "pending") {
      throw new AppError(409, "EMAIL_TAKEN", "This email address is currently being claimed by another account");
    }
    throw new AppError(409, "EMAIL_TAKEN", "This email address is already reserved by another account");
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
    // Standalone changes must reject a stale registration snapshot. Composed
    // registration updates already carry this canonical guard in their batch.
    ...(params.registrationOverride ? [] : [prepareRegistrationTransitionGuard(db, registration)]),
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
    db
      .prepare(
        `UPDATE users
         SET pending_email = ?, pending_email_expires_at = ?,
             pending_email_change_registration_id = ?,
             pending_email_current_confirmed_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(pendingEmailToStore, pendingEmailExpiresAt, registration.id, now, currentUser.id),
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
        recipientEmail: currentUser.email,
        kind: "email_change_authorization",
        currentEmail: currentUser.email,
        newEmail: pendingEmailToStore,
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
  try {
    await db.batch(prepared.statements);
  } catch (error) {
    if (isEmailReservationConflict(error)) throw emailTakenError();
    if (isRegistrationTransitionConflict(error)) {
      throw registrationChangedError();
    }
    throw error;
  }
  const { statements: _statements, ...result } = prepared;
  return result;
}

interface FinalizeEmailChangeResult {
  registration: RegistrationRecord;
  finalEmail: string;
}

export interface PreparedFinalizeEmailChange extends FinalizeEmailChangeResult {
  statements: StatementLike[];
}

/**
 * Finalizes an email change after token verification.
 *
 * Handles expired pending email and re-checks ownership immediately before
 * promotion. An address reserved by another identity always fails closed;
 * same-event registration overlap is not identity proof.
 *
 * All mutations run in a single db.batch() for atomicity.
 */
export async function prepareFinalizeEmailChange(
  db: DatabaseLike,
  params: {
    userId: string;
    eventId: string;
    registrationId: string;
    /** The confirmation transition can combine this write with its status update. */
    rotateManageLink?: boolean;
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
    pending_email_change_registration_id: string | null;
    pending_email_current_confirmed_at: string | null;
  }>(
    db,
    `SELECT id, email, normalized_email, pending_email, pending_email_expires_at,
            pending_email_change_registration_id, pending_email_current_confirmed_at
       FROM users WHERE id = ?`,
    [params.userId],
  );

  if (!user || !user.pending_email) {
    throw new AppError(400, "NO_PENDING_EMAIL", "No pending email change found for this user");
  }
  if (user.pending_email_change_registration_id !== params.registrationId) {
    throw new AppError(
      409,
      "EMAIL_CHANGE_REGISTRATION_MISMATCH",
      "This confirmation link does not belong to the pending email change",
    );
  }
  if (!user.pending_email_current_confirmed_at) {
    throw new AppError(
      409,
      "CURRENT_EMAIL_CONFIRMATION_REQUIRED",
      "The current email address must authorize this account change first",
    );
  }

  // Check expiration
  if (user.pending_email_expires_at && user.pending_email_expires_at < now) {
    // Clear expired pending email
    await run(
      db,
      `UPDATE users
          SET pending_email = NULL, pending_email_expires_at = NULL,
              pending_email_change_registration_id = NULL,
              pending_email_current_confirmed_at = NULL
        WHERE id = ? AND pending_email = ? AND pending_email_change_registration_id = ?`,
      [user.id, user.pending_email, params.registrationId],
    );
    throw new AppError(410, "PENDING_EMAIL_EXPIRED", "Email confirmation link has expired");
  }

  const newNormalized = normalizeEmail(user.pending_email);

  const emailOwner = await findUserEmailOwner(db, newNormalized);
  if (emailOwner && emailOwner.userId !== user.id) {
    throw new AppError(409, "EMAIL_TAKEN", "This email address is already reserved by another account");
  }

  const nextManageLinkSecret = newCapabilityLinkSecret();
  const finalizedRegistration: RegistrationRecord = {
    ...registrationBefore,
    manage_link_secret: nextManageLinkSecret,
    updated_at: now,
  };
  const stmts: StatementLike[] =
    params.rotateManageLink === false ? [] : [prepareRegistrationTransitionGuard(db, registrationBefore)];
  // If the target is already this user's secondary alias, promote it rather
  // than leaving the same address represented twice on one account.
  if (emailOwner?.kind === "secondary") {
    stmts.push(
      db.prepare("DELETE FROM user_emails WHERE user_id = ? AND normalized_email = ?").bind(user.id, newNormalized),
    );
  }

  // Promote the pending email to the user's canonical email.
  stmts.push(
    db
      .prepare(
        `UPDATE users
            SET email = ?, normalized_email = ?,
                pending_email = NULL, pending_email_expires_at = NULL,
                pending_email_change_registration_id = NULL,
                pending_email_current_confirmed_at = NULL,
                updated_at = ?
          WHERE id = ? AND pending_email = ? AND pending_email_change_registration_id = ?`,
      )
      .bind(user.pending_email, newNormalized, now, user.id, user.pending_email, params.registrationId),
    // Keep this directly after the guarded user mutation: its `changes()`
    // assertion turns a concurrent clear/replacement of pending_email into a
    // full batch rollback before credentials or manage capabilities rotate.
    prepareAuditLogAfterOneChange(
      db,
      "user",
      user.id,
      "registration_email_change_promoted",
      "registration",
      registrationBefore.id,
      { previousEmail: user.email, newEmail: user.pending_email },
      now,
    ),
  );
  // A canonical login identifier changed. Invalidate every outstanding bearer
  // session and login link so neither the former mailbox nor a stale browser
  // can continue authenticating without proving control of the new address.
  stmts.push(
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, user.id),
    db.prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, user.id),
    db.prepare("UPDATE auth_magic_links SET used_at = ? WHERE user_id = ? AND used_at IS NULL").bind(now, user.id),
  );
  if (params.rotateManageLink !== false) {
    stmts.push(
      db
        .prepare(
          `UPDATE registrations
              SET manage_link_secret = ?, updated_at = ?
            WHERE id = ? AND event_id = ? AND user_id = ? AND manage_link_secret = ?`,
        )
        .bind(
          nextManageLinkSecret,
          now,
          registrationBefore.id,
          params.eventId,
          params.userId,
          registrationBefore.manage_link_secret,
        ),
    );
  }

  return {
    registration: finalizedRegistration,
    finalEmail: user.pending_email,
    statements: stmts,
  };
}

/** Clears only the email-change request owned by this registration. */
export function prepareClearRegistrationEmailChangeStatement(
  db: DatabaseLike,
  registrationId: string,
  userId: string,
  at = nowIso(),
): StatementLike {
  return db
    .prepare(
      `UPDATE users
          SET pending_email = NULL, pending_email_expires_at = NULL,
              pending_email_change_registration_id = NULL,
              pending_email_current_confirmed_at = NULL, updated_at = ?
        WHERE id = ? AND pending_email_change_registration_id = ?`,
    )
    .bind(at, userId, registrationId);
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
  try {
    await db.batch(prepared.statements);
  } catch (error) {
    if (isRegistrationTransitionConflict(error) || isAuditOneChangeGuardFailure(error)) {
      throw registrationChangedError();
    }
    throw error;
  }
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
    finalEmail: prepared.finalEmail,
  };
}
