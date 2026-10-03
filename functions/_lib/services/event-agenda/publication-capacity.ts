import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { AppError } from "../../errors";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";

/** One indexed aggregate guard checks every proposed capacity inside approval's atomic batch. */
function publicationCapacityEvidence(snapshot: AgendaSnapshot) {
  const sessions = snapshot.occurrences.map((item) => ({
    id: item.id,
    roomId: item.roomId,
    capacity: item.capacity,
    remoteCapacity: item.remoteCapacity,
  }));
  const rooms = snapshot.rooms.map((room) => ({ id: room.id, capacity: room.capacity }));
  return {
    sql: `WITH sessions AS(
 SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.roomId') AS room_id,json_extract(value,'$.capacity') AS capacity,json_extract(value,'$.remoteCapacity') AS remote_capacity FROM json_each(?)
 ),rooms AS(SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.capacity') AS capacity FROM json_each(?)),limits AS(
 SELECT session.id,session.remote_capacity,CASE WHEN session.capacity IS NULL THEN room.capacity WHEN room.capacity IS NULL THEN session.capacity ELSE MIN(session.capacity,room.capacity) END AS physical_capacity FROM sessions session LEFT JOIN rooms room ON room.id=session.room_id)
 SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM limits target WHERE
 (target.physical_capacity IS NOT NULL AND (SELECT COUNT(*) FROM(SELECT participation.user_id FROM agenda_session_participations participation WHERE participation.occurrence_id=target.id AND participation.status='reserved' AND participation.attendance_mode='physical' UNION SELECT admission.user_id FROM event_session_admissions admission WHERE admission.occurrence_id=target.id))>target.physical_capacity)
 OR(target.remote_capacity IS NOT NULL AND (SELECT COUNT(*) FROM agenda_session_participations participation WHERE participation.occurrence_id=target.id AND participation.status='reserved' AND participation.attendance_mode='remote')>target.remote_capacity))`,
    bindings: [JSON.stringify(sessions), JSON.stringify(rooms)],
  };
}

export function preparePublicationCapacityGuard(db: DatabaseLike, snapshot: AgendaSnapshot) {
  return prepareAuthorizationGuard(db, publicationCapacityEvidence(snapshot));
}
export async function assertPublicationCapacity(db: DatabaseLike, snapshot: AgendaSnapshot) {
  const evidence = publicationCapacityEvidence(snapshot);
  if (!(await first(db, evidence.sql, evidence.bindings)))
    throw new AppError(
      409,
      "AGENDA_RESERVED_CAPACITY",
      "The proposed capacity would displace confirmed or admitted attendees. Increase capacity before approving.",
    );
}
