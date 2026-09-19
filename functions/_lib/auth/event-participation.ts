import { first } from "../db/queries";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import type { DatabaseLike } from "../types";

/** Historical records retain self-service access; this grants no staff or membership permissions. */
export const EVENT_PARTICIPATION_SQL = `(
  EXISTS (SELECT 1 FROM registrations r WHERE r.user_id = user.id)
  OR EXISTS (SELECT 1 FROM session_proposals p
    WHERE p.proposer_user_id = user.id AND p.deleted_at IS NULL)
  OR EXISTS (SELECT 1 FROM proposal_speakers ps
    JOIN session_proposals p ON p.id = ps.proposal_id AND p.deleted_at IS NULL
    WHERE ps.user_id = user.id)
)`;

export async function hasEventParticipation(db: DatabaseLike, userId: string): Promise<boolean> {
  return Boolean(
    await first(
      db,
      `SELECT 1 AS eligible FROM users user
    WHERE user.id = ? AND user.active = 1 AND user.pii_redacted_at IS NULL AND ${EVENT_PARTICIPATION_SQL}`,
      [userId],
    ),
  );
}

export function eventParticipantSignInEvidence(userId: string, normalizedEmail: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM users user WHERE user.id = ? AND user.active = 1 AND user.pii_redacted_at IS NULL
      AND (user.normalized_email = ? OR EXISTS (
        SELECT 1 FROM user_emails email WHERE email.user_id = user.id
          AND email.normalized_email = ? AND email.verified_at IS NOT NULL))
      AND ${EVENT_PARTICIPATION_SQL}`,
    bindings: [userId, normalizedEmail, normalizedEmail],
  };
}
