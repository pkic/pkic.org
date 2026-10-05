import { operationalDays } from "./operational-days";
import { eventEntryOccupiedSql } from "../event-participation/event-entry-capacity";
import { operationalPeople } from "./operational-people";
import { agendaOccurrenceRoomIds } from "../../../../assets/shared/event-agenda-rooms";
import {
  physicalOccupiedSql,
  physicalRoomOccupiedSql,
  physicallyOccupiedRoomsSql,
  remoteOccupiedSql,
} from "../event-participation/capacity-accounting";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { AppError } from "../../errors";
import { first } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";

export interface ApprovedPublicationCapacityBasis {
  eventId: string;
  revision: number;
}

/** Approval uses proposed people; activation uses the exact approved normalized private authority. */
function publicationCapacityEvidence(snapshot: AgendaSnapshot, approved?: ApprovedPublicationCapacityBasis) {
  const sessions = snapshot.occurrences.map((item) => ({
    id: item.id,
    roomIds: agendaOccurrenceRoomIds(item),
    capacity: item.capacity,
    remoteCapacity: item.remoteCapacity,
    startAt: item.startAt,
    endAt: item.endAt,
  }));
  const rooms = snapshot.rooms.map((room) => ({
    id: room.id,
    capacity: room.capacity,
    setupMinutes: room.setupMinutes,
  }));
  const dayPeople = approved
    ? "SELECT event_id,day_date,user_id FROM event_agenda_operational_days WHERE event_id=? AND revision=?"
    : "SELECT (SELECT id FROM target_event) AS event_id,json_extract(value,'$.day_date') AS day_date,json_extract(value,'$.user_id') AS user_id FROM json_each(?)";
  const people = approved
    ? "SELECT occurrence_id,user_id,attendance_mode,room_id FROM event_agenda_operational_people WHERE event_id=? AND revision=?"
    : "SELECT json_extract(value,'$.occurrence_id') AS occurrence_id,json_extract(value,'$.user_id') AS user_id,json_extract(value,'$.attendance_mode') AS attendance_mode,json_extract(value,'$.room_id') AS room_id FROM json_each(?)";
  return {
    sql: `WITH target_event AS(SELECT id,capacity_in_person FROM events WHERE slug=?),day_people AS(${dayPeople}),day_limits AS(
 SELECT day.event_id,day.day_date,day.in_person_capacity AS capacity FROM event_days day WHERE day.event_id=(SELECT id FROM target_event)
 UNION SELECT (SELECT id FROM target_event),person.day_date,(SELECT capacity_in_person FROM target_event) FROM day_people person WHERE NOT EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=person.event_id AND day.day_date=person.day_date)
 ),operational_people AS(${people}),sessions AS(
 SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.roomIds') AS room_ids,json_extract(value,'$.capacity') AS capacity,json_extract(value,'$.remoteCapacity') AS remote_capacity,json_extract(value,'$.startAt') AS start_at,json_extract(value,'$.endAt') AS end_at FROM json_each(?)
 ),rooms AS(SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.capacity') AS capacity,json_extract(value,'$.setupMinutes') AS setup_minutes FROM json_each(?)),locations AS(
 SELECT session.id,placement.value AS room_id,room.capacity FROM sessions session JOIN json_each(session.room_ids) placement JOIN rooms room ON room.id=placement.value
 ),limits AS(SELECT session.id,session.room_ids,session.remote_capacity,CASE WHEN json_array_length(session.room_ids)=1 AND room.capacity IS NOT NULL THEN CASE WHEN session.capacity IS NULL THEN room.capacity ELSE MIN(session.capacity,room.capacity) END ELSE session.capacity END AS physical_capacity FROM sessions session LEFT JOIN rooms room ON room.id=json_extract(session.room_ids,'$[0]'))
 SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM day_limits day WHERE day.capacity IS NOT NULL AND day.capacity>0 AND ${eventEntryOccupiedSql("day.event_id", "day.day_date", undefined, true, undefined, "SELECT event_id,day_date,user_id FROM day_people")}>day.capacity)
 AND NOT EXISTS(SELECT 1 FROM operational_people person JOIN (
 SELECT occurrence_id,user_id,attendance_mode,room_id FROM agenda_session_participations WHERE status='reserved' AND occurrence_id IN(SELECT occurrence_id FROM operational_people)
 UNION SELECT occurrence_id,user_id,attendance_mode,room_id FROM agenda_session_holds WHERE occurrence_id IN(SELECT occurrence_id FROM operational_people) AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 ) allocation ON allocation.occurrence_id=person.occurrence_id AND allocation.user_id=person.user_id JOIN sessions target ON target.id=person.occurrence_id
 WHERE allocation.attendance_mode<>person.attendance_mode OR (person.attendance_mode='physical' AND COALESCE(allocation.room_id,json_extract(target.room_ids,'$[0]')) IS NOT person.room_id))
 AND NOT EXISTS(SELECT 1 FROM limits target WHERE
 (target.physical_capacity IS NOT NULL AND ${physicalOccupiedSql("target.id", undefined, undefined, "SELECT occurrence_id,user_id,attendance_mode,room_id FROM operational_people")}>target.physical_capacity)
 OR(target.remote_capacity IS NOT NULL AND ${remoteOccupiedSql("target.id", undefined, undefined, "SELECT occurrence_id,user_id,attendance_mode,room_id FROM operational_people")}>target.remote_capacity)
 OR EXISTS(SELECT 1 FROM (${physicallyOccupiedRoomsSql("target.id")}) held WHERE held.room_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM locations location WHERE location.id=target.id AND location.room_id=held.room_id)))
 AND NOT EXISTS(SELECT 1 FROM locations target WHERE target.capacity IS NOT NULL AND ${physicalRoomOccupiedSql("target.id", "target.room_id", undefined, undefined, "SELECT occurrence_id,user_id,attendance_mode,room_id FROM operational_people")}>target.capacity)`,
    bindings: [
      snapshot.eventSlug,
      ...(approved
        ? [approved.eventId, approved.revision, approved.eventId, approved.revision]
        : [JSON.stringify(operationalDays(snapshot)), JSON.stringify(operationalPeople(snapshot))]),
      JSON.stringify(sessions),
      JSON.stringify(rooms),
    ],
  };
}

export function preparePublicationCapacityGuard(
  db: DatabaseLike,
  snapshot: AgendaSnapshot,
  approved?: ApprovedPublicationCapacityBasis,
) {
  return prepareAuthorizationGuard(db, publicationCapacityEvidence(snapshot, approved));
}
export async function assertPublicationCapacity(db: DatabaseLike, snapshot: AgendaSnapshot) {
  const evidence = publicationCapacityEvidence(snapshot);
  if (!(await first(db, evidence.sql, evidence.bindings)))
    throw new AppError(
      409,
      "AGENDA_RESERVED_CAPACITY",
      "The proposed schedule would displace registered attendees or exceed capacity for registrations, event roles or organizer holds. Preserve their attendance mode and location, or update those allocations before approving.",
    );
}
