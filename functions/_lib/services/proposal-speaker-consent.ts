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
