import { liveOperationalPeopleSql } from "../event-agenda/operational-people";
import { physicalOccupiedSql, physicalRoomOccupiedSql } from "./capacity-accounting";
import { publishedRoomsSql } from "./published-schedule";
/** Trusted SQL expressions only. Both the session pool and selected room must have capacity. */
export function physicalAllocationAvailableSql(session: string, room: string, user: string) {
  return `(${session}.capacity IS NULL OR ${physicalOccupiedSql(`${session}.id`, user)}<${session}.capacity) AND (${room} IS NULL AND ${session}.room_id IS NULL AND json_array_length(${session}.additional_room_ids_json)=0 OR ${room} IS NOT NULL AND (${room}=${session}.room_id OR EXISTS(SELECT 1 FROM json_each(${session}.additional_room_ids_json) location WHERE location.value=${room})) AND EXISTS(SELECT 1 FROM (${publishedRoomsSql}) location WHERE location.id=${room} AND location.event_id=${session}.event_id AND (location.capacity IS NULL OR ${physicalRoomOccupiedSql(`${session}.id`, room, user)}<location.capacity)))`;
}

export function physicalRoomEligibleSql(session: string, room: string) {
  return `(${room} IS NULL AND ${session}.room_id IS NULL AND json_array_length(${session}.additional_room_ids_json)=0 OR ${room} IS NOT NULL AND (${room}=${session}.room_id OR EXISTS(SELECT 1 FROM json_each(${session}.additional_room_ids_json) available_room WHERE available_room.value=${room})) AND EXISTS(SELECT 1 FROM (${publishedRoomsSql}) available_room WHERE available_room.id=${room} AND available_room.event_id=${session}.event_id))`;
}

export function operationalAllocationCompatibleSql(occurrence: string, user: string, mode: string, room: string) {
  return `NOT EXISTS(SELECT 1 FROM (${liveOperationalPeopleSql}) operational WHERE operational.occurrence_id=${occurrence} AND operational.user_id=${user} AND (operational.attendance_mode<>${mode} OR operational.room_id IS NOT ${room}))`;
}
