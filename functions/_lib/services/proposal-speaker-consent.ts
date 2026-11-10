import { first } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";

/** Consent is unique per event/user/term version, even when first recorded on another proposal.
 * Approval uses the speaker's own unwithdrawn consent to every current required term. */
export async function prepareLateSpeakerConsentGuard(db: DatabaseLike, eventId: string, userId: string) {
  const evidence = {
    sql: `SELECT 1 WHERE NOT EXISTS (
      SELECT 1 FROM event_terms term
      WHERE term.event_id=? AND term.audience_type='speaker' AND term.active=1 AND term.required=1
        AND NOT EXISTS (
          SELECT 1 FROM consent_acceptances consent
          WHERE consent.event_id=term.event_id AND consent.user_id=?
            AND consent.audience_type='speaker' AND consent.term_key=term.term_key
            AND consent.term_version=term.version AND consent.withdrawn_at IS NULL
        )
    )`,
    bindings: [eventId, userId],
  };
  if (!(await first(db, evidence.sql, evidence.bindings)))
    throw new AppError(
      409,
      "SPEAKER_CONSENT_REQUIRED",
      "The speaker has not accepted the current event terms. Send a new invitation so they can review and accept the terms before approval.",
    );
  return prepareAuthorizationGuard(db, evidence);
}

/** Only active versions with this speaker's unwithdrawn event agreement can be preselected. */
export function prepareCurrentSpeakerConsents(db: DatabaseLike, eventId: string, userId: string) {
  return db
    .prepare(
      `SELECT consent.term_key AS termKey, consent.term_version AS version
    FROM consent_acceptances consent
    JOIN event_terms term ON term.event_id = consent.event_id
      AND term.audience_type = consent.audience_type AND term.term_key = consent.term_key
      AND term.version = consent.term_version AND term.active = 1
    WHERE consent.event_id = ? AND consent.user_id = ?
      AND consent.audience_type = 'speaker' AND consent.withdrawn_at IS NULL
    ORDER BY consent.term_key`,
    )
    .bind(eventId, userId);
}
