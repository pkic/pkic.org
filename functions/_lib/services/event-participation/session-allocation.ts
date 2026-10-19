import { liveOperationalPeopleSql } from "../event-agenda/operational-people";
import { physicalOccupiedSql } from "./capacity-accounting";
import { publishedRoomsSql } from "./published-schedule";

/**
 * Trusted SQL expressions only. A session's rooms are one physical pool: combined rooms or
 * staff-directed overflow, never an attendee's choice. The pool is the sum of its room
 * capacities, unlimited when the session has no room or any room has no capacity.
 */
export function physicalPoolCapacitySql(session: string) {
  return `(SELECT CASE WHEN COUNT(*)=0 OR COUNT(*)<>COUNT(pool_room.capacity) THEN NULL ELSE SUM(pool_room.capacity) END FROM (${publishedRoomsSql}) pool_room WHERE pool_room.event_id=${session}.event_id AND (pool_room.id=${session}.room_id OR EXISTS(SELECT 1 FROM json_each(${session}.additional_room_ids_json) pool_placement WHERE pool_placement.value=pool_room.id)))`;
}

/** Both the session capacity and its room pool must have a physical seat left. */
export function physicalAllocationAvailableSql(session: string, user: string) {
  return `(${session}.capacity IS NULL OR ${physicalOccupiedSql(`${session}.id`, user)}<${session}.capacity) AND (${physicalPoolCapacitySql(session)} IS NULL OR ${physicalOccupiedSql(`${session}.id`, user)}<${physicalPoolCapacitySql(session)})`;
}

/**
 * An operational role (speaker, staff) fixes a person's attendance mode. A room is compared
 * only where one is known, such as the location a scanner is admitting to.
 */
export function operationalAllocationCompatibleSql(occurrence: string, user: string, mode: string, room?: string) {
  const placement = room ? ` OR operational.room_id IS NOT ${room}` : "";
  return `NOT EXISTS(SELECT 1 FROM (${liveOperationalPeopleSql}) operational WHERE operational.occurrence_id=${occurrence} AND operational.user_id=${user} AND (operational.attendance_mode<>${mode}${placement}))`;
}
