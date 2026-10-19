import { liveOperationalPeopleSql } from "../event-agenda/operational-people";
/** Trusted SQL expressions only. Registration, operational roles and explicit holds share one pool. */
export function physicalAllocatedPeopleSql(
  occurrence: string,
  excludeUser?: string,
  now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  operational = liveOperationalPeopleSql,
) {
  const exclude = excludeUser ? ` AND user_id<>${excludeUser}` : "";
  return `SELECT user_id FROM (${operational}) operational WHERE occurrence_id=${occurrence} AND attendance_mode='physical'${exclude}
    UNION SELECT user_id FROM agenda_session_participations WHERE occurrence_id=${occurrence} AND status='reserved' AND attendance_mode='physical'${exclude}
    UNION SELECT user_id FROM agenda_session_holds WHERE occurrence_id=${occurrence} AND attendance_mode='physical' AND revoked_at IS NULL AND expires_at>${now}${exclude}`;
}
export function physicalOccupiedSql(
  occurrence: string,
  excludeUser?: string,
  now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  operational = liveOperationalPeopleSql,
): string {
  return `(SELECT COUNT(*) FROM (${physicalAllocatedPeopleSql(occurrence, excludeUser, now, operational)}))`;
}
export function remoteOccupiedSql(
  occurrence: string,
  excludeUser?: string,
  now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  operational = liveOperationalPeopleSql,
): string {
  const exclude = excludeUser ? ` AND user_id<>${excludeUser}` : "";
  return `(SELECT COUNT(*) FROM (SELECT user_id FROM (${operational}) operational WHERE occurrence_id=${occurrence} AND attendance_mode='remote'${exclude}
 UNION SELECT user_id FROM agenda_session_participations WHERE occurrence_id=${occurrence} AND status='reserved' AND attendance_mode='remote'${exclude}
    UNION SELECT user_id FROM agenda_session_holds WHERE occurrence_id=${occurrence} AND attendance_mode='remote' AND revoked_at IS NULL AND expires_at>${now}${exclude}))`;
}

/**
 * Attendees, waiting requests and organizer holds share the session's room pool and are never
 * placed in one room; only operational people (speakers, staff) are placed in a specific room.
 */
export function operationalRoomOccupiedSql(occurrence: string, room: string, operational = liveOperationalPeopleSql) {
  return `(SELECT COUNT(DISTINCT user_id) FROM (${operational}) operational WHERE occurrence_id=${occurrence} AND attendance_mode='physical' AND room_id IS ${room})`;
}
