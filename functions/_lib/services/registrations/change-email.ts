/**
 * Handles changing the email address for a registration, including:
 * - Finding or creating a user with the new email
 * - Reassigning the registration to that user
 * - Resetting the registration to pending_email_confirmation
 * - Generating a new confirmation token
 */

import { AppError } from "../../errors";
import { first, run } from "../../db/queries";
import { normalizeEmail } from "../../validation";
import { randomToken, sha256Hex } from "../../utils/crypto";
import { nowIso, addHours } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { checkEmailDomainMx } from "../../email/mx-check";
import type { DatabaseLike } from "../../types";
import type { RegistrationRecord } from "./types";

interface ChangeEmailResult {
  registration: RegistrationRecord;
  newUserId: string;
  confirmationToken: string;
  previousEmail: string;
}

/**
 * Changes the email on a registration by reassigning it to the user record
 * that owns the new address (creating one when necessary). Resets the
 * registration to `pending_email_confirmation` so the new address is verified
 * before the attendee is considered registered.
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
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
  }>(
    db,
    "SELECT id, email, normalized_email, first_name, last_name, organization_name, job_title FROM users WHERE id = ?",
    [registration.user_id],
  );
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

  // Check if a user with the new email already exists
  const existingUser = await first<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
  }>(
    db,
    "SELECT id, email, first_name, last_name, organization_name, job_title FROM users WHERE normalized_email = ?",
    [newNormalized],
  );

  let newUserId: string;
  const now = nowIso();

  if (existingUser) {
    // Check for duplicate registration: new user must not already be registered for this event
    const conflict = await first<{ id: string }>(
      db,
      "SELECT id FROM registrations WHERE event_id = ? AND user_id = ? AND id != ?",
      [registration.event_id, existingUser.id, registration.id],
    );
    if (conflict) {
      throw new AppError(409, "REGISTRATION_EXISTS", "A registration with this email already exists for this event");
    }
    newUserId = existingUser.id;
  } else {
    // Create a new user with the new email, copying profile fields from the current user
    newUserId = uuid();
    await run(
      db,
      `INSERT INTO users (
        id, email, normalized_email, first_name, last_name,
        organization_name, job_title, role, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'user', 1, ?, ?)`,
      [
        newUserId,
        params.newEmail,
        newNormalized,
        currentUser.first_name,
        currentUser.last_name,
        currentUser.organization_name,
        currentUser.job_title,
        now,
        now,
      ],
    );
  }

  // Generate a new confirmation token
  const confirmationToken = randomToken(24);
  const confirmationTokenHash = await sha256Hex(confirmationToken);
  const confirmationExpiresAt = addHours(now, params.confirmationTtlHours);

  // Reassign the registration to the new user and reset to pending confirmation
  await run(
    db,
    `UPDATE registrations
     SET user_id = ?,
         status = 'pending_email_confirmation',
         confirmation_token_hash = ?,
         confirmation_token_expires_at = ?,
         confirmed_at = NULL,
         updated_at = ?
     WHERE id = ?`,
    [newUserId, confirmationTokenHash, confirmationExpiresAt, now, registration.id],
  );

  const updated = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [registration.id]);
  if (!updated) {
    throw new AppError(500, "EMAIL_CHANGE_FAILED", "Failed to update registration");
  }

  return {
    registration: updated,
    newUserId,
    confirmationToken,
    previousEmail: currentUser.email,
  };
}
