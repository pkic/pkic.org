import type { DatabaseLike, StatementLike } from "../../types";

/**
 * Rotates every registration-management capability owned by a user except an
 * optional registration whose caller is replacing the secret in the same
 * batch. A canonical email change invalidates links delivered to the former
 * mailbox across all events, not only the registration that initiated it.
 */
export function prepareRotateUserRegistrationManageSecrets(
  db: DatabaseLike,
  userId: string,
  at: string,
  excludeRegistrationId?: string,
): StatementLike {
  // Generate a fresh value per matching row at execution time. Keeping this a
  // single set-based statement prevents a concurrent per-registration secret
  // rotation from escaping the canonical-email-change revocation boundary.
  return db
    .prepare(
      `UPDATE registrations
          SET manage_link_secret = lower(hex(randomblob(32))), updated_at = ?
        WHERE user_id = ?
          AND (? IS NULL OR id != ?)`,
    )
    .bind(at, userId, excludeRegistrationId ?? null, excludeRegistrationId ?? null);
}

/**
 * Rotates every proposal-speaker management capability owned by a user.
 * Incrementing invite_generation also invalidates presentation uploads that
 * were authorized before the canonical email changed but have not committed.
 */
export function prepareRotateUserProposalSpeakerManageSecrets(db: DatabaseLike, userId: string): StatementLike {
  return db
    .prepare(
      `UPDATE proposal_speakers
          SET manage_link_secret = lower(hex(randomblob(32))),
              invite_generation = invite_generation + 1
        WHERE user_id = ?`,
    )
    .bind(userId);
}
