import { operationalPeople } from "./operational-people";
import { agendaOccurrenceRoomIds } from "../../../../assets/shared/event-agenda-rooms";
import { physicallyOccupiedRoomsSql } from "../event-participation/capacity-accounting";
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
 * The schedule must only keep existing reservations and active organizer holds in their attendance mode and room.
 * Planning and approval use proposed people; activation uses the exact approved normalized private authority. */
function publicationAllocationEvidence(snapshot: AgendaSnapshot, approved?: ApprovedPublicationAllocationBasis) {
  const sessions = snapshot.occurrences.map((item) => ({ id: item.id, roomIds: agendaOccurrenceRoomIds(item) }));
  const rooms = snapshot.rooms.map((room) => ({ id: room.id }));
  const people = approved
    ? "SELECT occurrence_id,user_id,attendance_mode,room_id FROM event_agenda_operational_people WHERE event_id=? AND revision=?"
    : "SELECT json_extract(value,'$.occurrence_id') AS occurrence_id,json_extract(value,'$.user_id') AS user_id,json_extract(value,'$.attendance_mode') AS attendance_mode,json_extract(value,'$.room_id') AS room_id FROM json_each(?)";
  return {
    sql: `WITH operational_people AS(${people}),sessions AS(
 SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.roomIds') AS room_ids FROM json_each(?)
 ),rooms AS(SELECT json_extract(value,'$.id') AS id FROM json_each(?)),locations AS(
 SELECT session.id,placement.value AS room_id FROM sessions session JOIN json_each(session.room_ids) placement JOIN rooms room ON room.id=placement.value
 )
 SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM operational_people person JOIN (
 SELECT occurrence_id,user_id,attendance_mode,room_id FROM agenda_session_participations WHERE status='reserved' AND occurrence_id IN(SELECT occurrence_id FROM operational_people)
 UNION SELECT occurrence_id,user_id,attendance_mode,room_id FROM agenda_session_holds WHERE occurrence_id IN(SELECT occurrence_id FROM operational_people) AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 ) allocation ON allocation.occurrence_id=person.occurrence_id AND allocation.user_id=person.user_id JOIN sessions target ON target.id=person.occurrence_id
 WHERE allocation.attendance_mode<>person.attendance_mode OR (person.attendance_mode='physical' AND COALESCE(allocation.room_id,json_extract(target.room_ids,'$[0]')) IS NOT person.room_id))
 AND NOT EXISTS(SELECT 1 FROM sessions target WHERE EXISTS(SELECT 1 FROM (${physicallyOccupiedRoomsSql("target.id")}) held WHERE held.room_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM locations location WHERE location.id=target.id AND location.room_id=held.room_id)))`,
    bindings: [
      ...(approved ? [approved.eventId, approved.revision] : [JSON.stringify(operationalPeople(snapshot))]),
      JSON.stringify(sessions),
      JSON.stringify(rooms),
    ],
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
      "The proposed schedule would move registered attendees or organizer holds to another room or attendance mode. Preserve their allocation or update it before approving.",
    );
}
