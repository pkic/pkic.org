import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";

/** Publication requires known people and representation; source attribution alone remains a mapping draft. */
export async function assertPublicationRepresentations(db: DatabaseLike, eventId: string, snapshot: AgendaSnapshot) {
  const approvalTime = Date.parse(nowIso());
  if (
    snapshot.occurrences.some((occurrence) =>
      occurrence.history?.appearances.some((appearance) => Date.parse(appearance.approvedAt) > approvalTime),
    )
  )
    throw new AppError(422, "APPEARANCE_APPROVAL_IN_FUTURE", "An appearance approval cannot be dated in the future.");
  if (
    snapshot.occurrences.some(
      (occurrence) =>
        Boolean(occurrence.history?.archivalCredits.length) ||
        occurrence.history?.sourceDecisions.some(
          (decision) => decision.decision === "title_not_recorded" || decision.decision === "credit_not_recorded",
        ),
    )
  )
    throw new AppError(
      422,
      "AGENDA_HISTORICAL_MAPPING_REQUIRED",
      "Resolve missing historical titles, people, and representation through verified mappings before approving this agenda.",
    );
  const missing = await first<{ id: string }>(
    db,
    `SELECT occurrence.id FROM event_agenda_occurrences occurrence
     JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=occurrence.id
     LEFT JOIN event_agenda_session_history history ON history.occurrence_id=occurrence.id
     WHERE occurrence.event_id=? AND occurrence.id IN(SELECT value FROM json_each(?))
       AND NOT EXISTS(SELECT 1 FROM json_each(history.metadata_json,'$.appearances') appearance
         WHERE json_extract(appearance.value,'$.userId')=speaker.user_id
           AND json_extract(appearance.value,'$.approvedAt') IS NOT NULL)
     LIMIT 1`,
    [eventId, JSON.stringify(snapshot.occurrences.map((occurrence) => occurrence.id))],
  );
  if (missing)
    throw new AppError(
      422,
      "AGENDA_REPRESENTATION_REVIEW_REQUIRED",
      "Review and approve each speaker's representation before approving this agenda.",
    );
}
