import { instantToCalendarDate } from "../../../../assets/shared/timezone";
import type { Env } from "../../types";
import { liveLocationChatName } from "./room-admission";

/**
 * Tells the location's chat of each day the studio left or entered which session it has loaded now, so later
 * messages are dated by it. A day's chat ignores a session of another day, which is how the day the studio
 * left falls back to the agenda. One bounded read finds the days; a chat nobody joined yet stores nothing.
 */
export async function tellLiveLocationChats(
  env: Pick<Env, "DB" | "LIVE_SESSION_ROOMS">,
  eventId: string,
  roomId: string,
  occurrenceIds: readonly (string | null)[],
  loaded: string | null,
): Promise<void> {
  const ids = [...new Set(occurrenceIds.filter((id): id is string => Boolean(id)))];
  const rooms = env.LIVE_SESSION_ROOMS;
  if (!ids.length || !rooms) return;
  const { results } = await env.DB.prepare(
    `SELECT json_extract(approved.payload_json,'$.startAt') AS start_at, event.timezone FROM event_agenda_state state
     JOIN event_agenda_published_occurrences approved ON approved.event_id=state.event_id AND approved.revision=state.published_revision
     JOIN events event ON event.id=state.event_id
     WHERE state.event_id=? AND approved.occurrence_id IN (SELECT value FROM json_each(?))`,
  )
    .bind(eventId, JSON.stringify(ids))
    .all<{ start_at: string | null; timezone: string }>();
  const days = new Set(
    results.flatMap((row) => (row.start_at ? [instantToCalendarDate(row.start_at, row.timezone)] : [])),
  );
  for (const day of days) await rooms.getByName(liveLocationChatName(eventId, roomId, day)).locationChatLoaded(loaded);
}
