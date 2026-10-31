import type { AuthorizationEvidence } from "../../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../../types";

/**
 * Revokes every stale registration confirmation and rotates management capabilities owned by a user except an
 * optional registration whose caller is replacing the secret in the same
 * batch. A canonical email change invalidates links delivered to the former
 * mailbox across all events, not only the registration that initiated it.
 */
export function prepareRotateUserRegistrationCapabilities(
  db: DatabaseLike,
  userId: string,
  at: string,
  excludeRegistrationId?: string,
  condition?: AuthorizationEvidence,
): StatementLike {
  // Generate a fresh value per matching row at execution time. Keeping this a
  // single set-based statement prevents a concurrent per-registration secret
  // rotation from escaping the canonical-email-change revocation boundary.
  return db
    .prepare(
      `UPDATE registrations
          SET manage_link_secret = lower(hex(randomblob(32))),confirmation_link_secret=NULL,
              pending_confirmation_deadline_at=NULL,confirmation_reminder_sent_at=NULL,updated_at = ?
        WHERE user_id = ?
          AND (? IS NULL OR id != ?)${condition ? ` AND EXISTS (${condition.sql})` : ""}`,
    )
    .bind(at, userId, excludeRegistrationId ?? null, excludeRegistrationId ?? null, ...(condition?.bindings ?? []));
}

/**
 * Rotates proposal-speaker capabilities except the current invitation whose
 * resource-scoped authority was just established by signed mailbox proof.
 * Incrementing invite_generation also invalidates presentation uploads that
 * were authorized before the canonical email changed but have not committed.
 */
export function prepareRotateUserProposalSpeakerManageSecrets(
  db: DatabaseLike,
  userId: string,
  condition?: AuthorizationEvidence,
  provedSpeakerId?: string,
): StatementLike {
  return db
    .prepare(
      `UPDATE proposal_speakers
          SET manage_link_secret = lower(hex(randomblob(32))),
              invite_generation = invite_generation + 1
        WHERE user_id = ? AND (? IS NULL OR id<>?)${condition ? ` AND EXISTS (${condition.sql})` : ""}`,
    )
    .bind(userId, provedSpeakerId ?? null, provedSpeakerId ?? null, ...(condition?.bindings ?? []));
}

/** Revoke proposal-level links as well as the separate speaker links. */
export function prepareRotateUserProposalManageSecrets(
  db: DatabaseLike,
  userId: string,
  condition?: AuthorizationEvidence,
): StatementLike {
  return db
    .prepare(`UPDATE session_proposals SET manage_link_secret=lower(hex(randomblob(32)))
    WHERE proposer_user_id=?${condition ? ` AND EXISTS (${condition.sql})` : ""}`)
    .bind(userId, ...(condition?.bindings ?? []));
}

/**
 * Rotates the proposal-speaker capabilities whose link was mailed to one
 * address of a user, for use before that address is released. The link now
 * sits in a mailbox the account no longer owns, so it must stop opening the
 * speaker page; links mailed to the account's other addresses keep working.
 */
export function prepareRotateProposalSpeakerSecretsMailedToUserEmail(
  db: DatabaseLike,
  userId: string,
  emailId: string,
): StatementLike {
  return db
    .prepare(
      `UPDATE proposal_speakers
          SET manage_link_secret = lower(hex(randomblob(32))),
              invite_generation = invite_generation + 1
        WHERE user_id = ?
          AND lower(invited_email) = (SELECT normalized_email FROM user_emails WHERE id = ? AND user_id = ?)`,
    )
    .bind(userId, emailId, userId);
}
