/**
 * The virtual room's read: every location of the published agenda that has a live stream, with its usual
 * stream and per-day replacements. Stream references are released only to a signed-in person holding a
 * registration for the event (any attendance type) or to event staff; everyone else learns nothing about them.
 */
import { virtualRoomResponseSchema } from "../../../../assets/shared/schemas/event-live-stream";
import { instantToCalendarDate } from "../../../../assets/shared/timezone";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { locationStreams, type LiveStreamRow } from "../event-agenda/location-live-streams";
import { publishedRoomsSql } from "./published-schedule";

/** Binds: session id, user id, staff flag (1/0), event id. */
const viewerMayWatchSql = `EXISTS(SELECT 1 FROM sessions viewer_session JOIN users viewer ON viewer.id=viewer_session.user_id AND viewer.active=1
  WHERE viewer_session.id=? AND viewer_session.user_id=? AND viewer_session.revoked_at IS NULL AND viewer_session.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND (?=1 OR EXISTS(SELECT 1 FROM registrations registration WHERE registration.event_id=? AND registration.user_id=viewer.id AND registration.status='registered')))`;

export async function readVirtualRoom(
  db: DatabaseLike,
  event: { id: string; timezone: string },
  viewer: { userId: string; sessionId: string; staff: boolean },
) {
  const access = [viewer.sessionId, viewer.userId, viewer.staff ? 1 : 0, event.id];
  const allowed = await first<{ allowed: number }>(db, `SELECT ${viewerMayWatchSql} AS allowed`, access);
  if (!allowed?.allowed)
    throw new AppError(
      403,
      "VIRTUAL_ROOM_UNAVAILABLE",
      "A registration for this event is required to watch its live streams.",
    );
  const rows = await all<LiveStreamRow & { id: string; name: string }>(
    db,
    `SELECT location.id,location.name,stream.day_date,stream.provider,stream.stream_ref
      FROM (${publishedRoomsSql}) location
      JOIN event_agenda_room_streams stream ON stream.room_id=location.id AND stream.event_id=location.event_id
      WHERE location.event_id=? AND ${viewerMayWatchSql}
      ORDER BY CAST(location.position AS INTEGER),location.id,stream.day_date IS NOT NULL,stream.day_date`,
    [event.id, ...access],
  );
  const locations = new Map<string, { id: string; name: string; rows: LiveStreamRow[] }>();
  for (const row of rows) {
    const location = locations.get(row.id) ?? { id: row.id, name: row.name, rows: [] };
    location.rows.push(row);
    locations.set(row.id, location);
  }
  return virtualRoomResponseSchema.parse({
    timeZone: event.timezone,
    locations: [...locations.values()].map(({ id, name, rows: streams }) => ({
      id,
      name,
      ...locationStreams(streams),
    })),
  });
}

/**
 * For a published session `s`, the event days on which its primary location streams ("*" for its usual
 * stream) as a JSON array, or NULL when the viewer holds no registration or the session's own media plan
 * excludes live streaming. Binds: the viewer's user id.
 */
export function liveStreamDaysSql(session: string) {
  return `CASE WHEN ${session}.room_id IS NOT NULL AND ${session}.start_at IS NOT NULL AND COALESCE(${session}.planned_live_streaming,1)=1
    AND EXISTS(SELECT 1 FROM registrations stream_registration WHERE stream_registration.event_id=${session}.event_id AND stream_registration.user_id=? AND stream_registration.status='registered')
    THEN (SELECT json_group_array(COALESCE(stream.day_date,'*')) FROM event_agenda_room_streams stream WHERE stream.room_id=${session}.room_id AND stream.event_id=${session}.event_id) END`;
}

/** The location whose virtual room shows the session live, when it streams on the session's own day. */
export function sessionLiveStreamRoom(
  session: { roomId: string | null; startAt: string | null; timeZone: string },
  streamDaysJson: string | null,
): string | null {
  if (!session.roomId || !session.startAt || !streamDaysJson) return null;
  const days = JSON.parse(streamDaysJson) as string[];
  return days.includes("*") || days.includes(instantToCalendarDate(session.startAt, session.timeZone))
    ? session.roomId
    : null;
}
