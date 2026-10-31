import {
  prepareRotateUserRegistrationCapabilities,
  prepareRotateUserProposalSpeakerManageSecrets,
  prepareRotateUserProposalManageSecrets,
} from "./registrations/manage-capability-revocation";
import type { z } from "zod";
import { emailVerificationMethodSchema } from "../../../assets/shared/schemas/identity";
import type { DatabaseLike, StatementLike } from "../types";
import { nowIso } from "../utils/time";

export type EmailVerificationMethod = z.infer<typeof emailVerificationMethodSchema>;

/** Records proof only when the address that was actually verified is still primary. */
function prepareVerifyPrimaryEmailStatement(
  db: DatabaseLike,
  input: {
    userId: string;
    normalizedEmail: string;
    method: EmailVerificationMethod;
    verifiedAt?: string;
    excludeRegistrationId?: string;
    provedSpeakerId?: string;
  },
): StatementLike {
  const verifiedAt = input.verifiedAt ?? nowIso();
  return db
    .prepare(
      `UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, ?), email_verification_method = ?, updated_at = ?
        WHERE id = ? AND normalized_email = ?`,
    )
    .bind(verifiedAt, input.method, verifiedAt, input.userId, input.normalizedEmail);
}

/**
 * Records proof for whichever address the capability actually reached.
 * Exactly one statement changes because primary and secondary addresses share
 * one database-enforced reservation namespace.
 */
export function prepareVerifyOwnedEmailStatements(
  db: DatabaseLike,
  input: {
    userId: string;
    normalizedEmail: string;
    method: EmailVerificationMethod;
    verifiedAt?: string;
    excludeRegistrationId?: string;
    provedSpeakerId?: string;
  },
): StatementLike[] {
  const verifiedAt = input.verifiedAt ?? nowIso();
  return [
    ...prepareVerifyPrimaryEmailStatements(db, { ...input, verifiedAt }),
    db
      .prepare(
        `UPDATE user_emails
            SET verified_at = ?, verification_method = ?
          WHERE user_id = ? AND normalized_email = ?`,
      )
      .bind(verifiedAt, input.method, input.userId, input.normalizedEmail),
  ];
}

/** First mailbox proof must not adopt credentials installed before the account was owned. */
export function prepareVerifyPrimaryEmailStatements(
  db: DatabaseLike,
  input: {
    userId: string;
    normalizedEmail: string;
    method: EmailVerificationMethod;
    verifiedAt?: string;
    excludeRegistrationId?: string;
    provedSpeakerId?: string;
  },
): StatementLike[] {
  const at = input.verifiedAt ?? nowIso();
  const recovering = `EXISTS (SELECT 1 FROM users person WHERE person.id = ?
    AND person.normalized_email = ? AND person.email_verified_at IS NULL)`;
  return [
    ...["sessions", "passkey_credentials", "agenda_calendar_subscriptions", "event_badge_credentials"].map((table) =>
      db
        .prepare(`UPDATE ${table} SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND ${recovering}`)
        .bind(at, input.userId, input.userId, input.normalizedEmail),
    ),
    db
      .prepare(`UPDATE user_email_sign_in_permissions SET revoked_at = ? WHERE revoked_at IS NULL
      AND email_id IN (SELECT id FROM user_emails WHERE user_id = ?) AND ${recovering}`)
      .bind(at, input.userId, input.userId, input.normalizedEmail),
    prepareRotateUserRegistrationCapabilities(db, input.userId, at, input.excludeRegistrationId, {
      sql: `SELECT 1 WHERE ${recovering}`,
      bindings: [input.userId, input.normalizedEmail],
    }),
    prepareRotateUserProposalManageSecrets(db, input.userId, {
      sql: `SELECT 1 WHERE ${recovering}`,
      bindings: [input.userId, input.normalizedEmail],
    }),
    prepareRotateUserProposalSpeakerManageSecrets(
      db,
      input.userId,
      {
        sql: `SELECT 1 WHERE ${recovering}`,
        bindings: [input.userId, input.normalizedEmail],
      },
      input.provedSpeakerId,
    ),
    db
      .prepare(`UPDATE users SET pending_email=NULL,pending_email_expires_at=NULL,pending_email_change_registration_id=NULL
      WHERE id=? AND ${recovering}`)
      .bind(input.userId, input.userId, input.normalizedEmail),
    prepareVerifyPrimaryEmailStatement(db, { ...input, verifiedAt: at }),
  ];
}
