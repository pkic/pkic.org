import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { prepareParticipationReconciliation } from "./reconciliation";
function bookingOverlapEvidence(eventId: string, snapshot: AgendaSnapshot) {
  return {
    sql: `SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM agenda_session_participations first_claim
  JOIN agenda_session_participations second_claim ON second_claim.user_id=first_claim.user_id AND second_claim.event_id=first_claim.event_id AND second_claim.occurrence_id>first_claim.occurrence_id
  JOIN json_each(?) first_session ON json_extract(first_session.value,'$.id')=first_claim.occurrence_id
  JOIN json_each(?) second_session ON json_extract(second_session.value,'$.id')=second_claim.occurrence_id
  WHERE first_claim.event_id=? AND first_claim.status='reserved' AND second_claim.status='reserved'
  AND json_extract(first_session.value,'$.startAt')<json_extract(second_session.value,'$.endAt')
  AND json_extract(first_session.value,'$.endAt')>json_extract(second_session.value,'$.startAt'))`,
    bindings: [JSON.stringify(snapshot.occurrences), JSON.stringify(snapshot.occurrences), eventId],
  };
}
export async function assertPublicationParticipation(db: DatabaseLike, eventId: string, snapshot: AgendaSnapshot) {
  const evidence = bookingOverlapEvidence(eventId, snapshot);
  if (!(await first(db, evidence.sql, evidence.bindings)))
    throw new AppError(
      409,
      "AGENDA_ATTENDEE_OVERLAP",
      "The proposed times overlap an attendee's confirmed reservations. Resolve the conflict before approving.",
    );
}
export function preparePublicationParticipationGuard(db: DatabaseLike, eventId: string, snapshot: AgendaSnapshot) {
  return prepareAuthorizationGuard(db, bookingOverlapEvidence(eventId, snapshot));
}
/** Run after the approved revision becomes authoritative, within the same publication batch. */
export function preparePublicationParticipationChanges(db: DatabaseLike, eventId: string, snapshot: AgendaSnapshot) {
  const days = snapshot.occurrences.map((session) => ({
    id: session.id,
    day: session.startAt ? instantToDateTimeLocal(session.startAt, snapshot.timeZone).slice(0, 10) : null,
  }));
  return [
    db
      .prepare(
        `UPDATE agenda_session_participations AS participation SET attendance_day_date=(SELECT json_extract(value,'$.day') FROM json_each(?) WHERE json_extract(value,'$.id')=participation.occurrence_id)
  WHERE event_id=?`,
      )
      .bind(JSON.stringify(days), eventId),
    ...prepareParticipationReconciliation(db, eventId),
  ];
}
