import { liveOperationalPeopleSql } from "../event-agenda/operational-people";
import { publishedSessionsSql } from "./published-schedule";
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

/** Each physical location has its own pool; legacy single-room rows resolve to the primary room. */
export function physicalRoomOccupiedSql(
  occurrence: string,
  room: string,
  excludeUser?: string,
  now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')",
  operational = liveOperationalPeopleSql,
) {
  const exclude = excludeUser ? ` AND user_id<>${excludeUser}` : "";
  const primary = `(SELECT room_id FROM (${publishedSessionsSql}) approved_session WHERE approved_session.id=${occurrence})`;
  return `(SELECT COUNT(*) FROM (
 SELECT user_id FROM (${operational}) operational WHERE occurrence_id=${occurrence} AND attendance_mode='physical' AND room_id IS ${room}${exclude}
 UNION SELECT user_id FROM agenda_session_participations WHERE occurrence_id=${occurrence} AND status='reserved' AND attendance_mode='physical' AND COALESCE(room_id,${primary}) IS ${room}${exclude}
 UNION SELECT user_id FROM agenda_session_holds WHERE occurrence_id=${occurrence} AND attendance_mode='physical' AND revoked_at IS NULL AND expires_at>${now} AND COALESCE(room_id,${primary}) IS ${room}${exclude}
 ))`;
}
/** Locations holding registrations or explicit organizer holds remain in the approved session. */
export function physicallyOccupiedRoomsSql(occurrence: string, now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')") {
  const primary = `(SELECT room_id FROM (${publishedSessionsSql}) approved_session WHERE approved_session.id=${occurrence})`;
  return `SELECT COALESCE(room_id,${primary}) AS room_id FROM agenda_session_participations WHERE occurrence_id=${occurrence} AND status='reserved' AND attendance_mode='physical'
 UNION SELECT COALESCE(room_id,${primary}) FROM agenda_session_holds WHERE occurrence_id=${occurrence} AND attendance_mode='physical' AND revoked_at IS NULL AND expires_at>${now}
`;
}
