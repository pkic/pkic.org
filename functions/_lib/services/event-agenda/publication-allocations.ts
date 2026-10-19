import { operationalPeople } from "./operational-people";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { AppError } from "../../errors";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";

export interface ApprovedPublicationAllocationBasis {
  eventId: string;
  revision: number;
}

/** Agenda work never enforces capacity; attendees reserve against capacity when they register or book.
 * The schedule must only keep existing reservations and active organizer holds in their attendance mode. Attendees
 * share the session's room pool, so moving or combining rooms never displaces them.
 * Planning and approval use proposed people; activation uses the exact approved normalized private authority. */
function publicationAllocationEvidence(snapshot: AgendaSnapshot, approved?: ApprovedPublicationAllocationBasis) {
  const people = approved
    ? "SELECT occurrence_id,user_id,attendance_mode FROM event_agenda_operational_people WHERE event_id=? AND revision=?"
    : "SELECT json_extract(value,'$.occurrence_id') AS occurrence_id,json_extract(value,'$.user_id') AS user_id,json_extract(value,'$.attendance_mode') AS attendance_mode FROM json_each(?)";
  return {
    sql: `WITH operational_people AS(${people})
 SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM operational_people person JOIN (
 SELECT occurrence_id,user_id,attendance_mode FROM agenda_session_participations WHERE status='reserved' AND occurrence_id IN(SELECT occurrence_id FROM operational_people)
 UNION SELECT occurrence_id,user_id,attendance_mode FROM agenda_session_holds WHERE occurrence_id IN(SELECT occurrence_id FROM operational_people) AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 ) allocation ON allocation.occurrence_id=person.occurrence_id AND allocation.user_id=person.user_id
 WHERE allocation.attendance_mode<>person.attendance_mode)`,
    bindings: approved ? [approved.eventId, approved.revision] : [JSON.stringify(operationalPeople(snapshot))],
  };
}

export function preparePublicationAllocationGuard(
  db: DatabaseLike,
  snapshot: AgendaSnapshot,
  approved?: ApprovedPublicationAllocationBasis,
) {
  return prepareAuthorizationGuard(db, publicationAllocationEvidence(snapshot, approved));
}
export async function assertPublicationAllocations(db: DatabaseLike, snapshot: AgendaSnapshot) {
  const evidence = publicationAllocationEvidence(snapshot);
  if (!(await first(db, evidence.sql, evidence.bindings)))
    throw new AppError(
      409,
      "AGENDA_RESERVED_ALLOCATION",
      "The proposed schedule would move registered attendees or organizer holds to another attendance mode. Preserve their allocation or update it before approving.",
    );
}
