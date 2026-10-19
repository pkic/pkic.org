import { INDEPENDENT_CAPACITY_REVIEW_COPY } from "../../../../assets/shared/email-first-copy";
import { UNVERIFIED_INDEPENDENT_APPEARANCE_CODE } from "../../../../assets/shared/schemas/independent-capacity";
import { appearanceIdentityIds, type SessionAppearance } from "../../../../assets/shared/schemas/event-session-history";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareScopedAuditLog } from "../audit";

/**
 * Approving an individual appearance for a speaker whose independence
 * disclosure on the session's source proposal is not verified never passes
 * silently: it is refused until the editor acknowledges those speakers, and
 * the acknowledgment is audited with the revision. Unchanged appearances are
 * not asked about again.
 */
export async function prepareIndependentAppearanceApproval(
  db: DatabaseLike,
  input: {
    eventId: string;
    occurrenceId: string;
    appearances: readonly SessionAppearance[];
    previous: readonly SessionAppearance[];
    acknowledged: readonly string[];
    actorUserId: string;
    at: string;
  },
): Promise<StatementLike[]> {
  const changedIndividuals = input.appearances.filter(
    (appearance) =>
      appearanceIdentityIds(appearance).length === 0 &&
      !input.previous.some((prior) => JSON.stringify(prior) === JSON.stringify(appearance)),
  );
  if (!changedIndividuals.length) return [];
  const unverified = await all<{ user_id: string; display_name: string; proposal_id: string; disclosure_id: string }>(
    db,
    `SELECT speaker.user_id,
            COALESCE(NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')),''),u.email) AS display_name,
            proposal.id AS proposal_id,disclosure.id AS disclosure_id
     FROM event_agenda_occurrences occurrence
     JOIN session_proposals proposal
       ON occurrence.source_key='proposal:'||proposal.id AND proposal.event_id=occurrence.event_id
     JOIN proposal_speakers speaker ON speaker.proposal_id=proposal.id
     JOIN users u ON u.id=speaker.user_id
     JOIN proposal_speaker_independent_disclosures disclosure
       ON disclosure.proposal_speaker_id=speaker.id AND disclosure.superseded_at IS NULL
     WHERE occurrence.id=? AND occurrence.event_id=? AND disclosure.review_status<>'verified'
       AND speaker.user_id IN (SELECT value FROM json_each(?))
     LIMIT 30`,
    [input.occurrenceId, input.eventId, JSON.stringify(changedIndividuals.map((item) => item.userId))],
  );
  const missing = unverified.filter((row) => !input.acknowledged.includes(row.user_id));
  if (missing.length)
    throw new AppError(
      409,
      UNVERIFIED_INDEPENDENT_APPEARANCE_CODE,
      INDEPENDENT_CAPACITY_REVIEW_COPY.appearanceWarning(missing.map((row) => row.display_name).join(", ")),
      { speakers: missing.map((row) => ({ userId: row.user_id, displayName: row.display_name })) },
    );
  return unverified.map((row) =>
    prepareScopedAuditLog(
      db,
      { type: "proposal", id: row.proposal_id },
      "admin",
      input.actorUserId,
      "independent_appearance_approved_unverified",
      "agenda_occurrence",
      input.occurrenceId,
      { speakerUserId: row.user_id, disclosureId: row.disclosure_id },
      input.at,
    ),
  );
}
