import { AppError } from "../../errors";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { scannerSuggestionsResponseSchema } from "../../../../assets/shared/schemas/event-scanner-suggestions";
import { publishedRoomsSql, publishedSessionsSql } from "./published-schedule";
/** Approved duties suggest context only; route authorization remains independent. Never called per badge. */
export async function scannerSuggestions(db: DatabaseLike, eventId: string, operatorId: string, now = new Date()) {
  const serverTime = now.toISOString();
  const horizon = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const publication = await first<{ revision: number | null; timezone: string }>(
    db,
    "SELECT p.revision,e.timezone FROM events e LEFT JOIN event_agenda_state s ON s.event_id=e.id LEFT JOIN event_agenda_publications p ON p.event_id=e.id AND p.revision=s.published_revision WHERE e.id=?",
    [eventId],
  );
  if (!publication) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found.");
  const timeZone = publication.timezone;
  if (publication.revision === null)
    return scannerSuggestionsResponseSchema.parse({
      serverTime,
      timeZone,
      publishedRevision: null,
      suggestions: [],
      truncated: false,
    });
  const rows = await all<{
    shift_id: string;
    shift_name: string;
    shift_start: string;
    shift_end: string;
    roles_json: string;
    room_id: string | null;
    id: string;
    title: string;
    start_at: string;
    end_at: string;
    rooms_json: string;
  }>(
    db,
    `WITH duties AS (
    SELECT json_extract(b.value,'$.id') shift_id,json_extract(b.value,'$.name') shift_name,
      json_extract(b.value,'$.startAt') shift_start,json_extract(b.value,'$.endAt') shift_end,
      json_extract(b.value,'$.roomId') room_id,
      json_group_array(DISTINCT json_extract(a.value,'$.role')) roles_json
    FROM event_agenda_publications p
    JOIN event_agenda_state st ON st.event_id=p.event_id AND st.published_revision=p.revision
    JOIN json_each(p.snapshot_json,CASE WHEN json_type(p.snapshot_json,'$.shifts') IS NOT NULL THEN '$.shifts' ELSE '$.blocks' END) b
    JOIN json_each(p.snapshot_json,'$.assignments') a ON COALESCE(json_extract(a.value,'$.shiftId'),json_extract(a.value,'$.blockId'))=json_extract(b.value,'$.id')
    WHERE NOT (json_type(p.snapshot_json,'$.shifts') IS NOT NULL AND json_type(p.snapshot_json,'$.blocks') IS NOT NULL)
      AND NOT (json_type(a.value,'$.shiftId') IS NOT NULL AND json_type(a.value,'$.blockId') IS NOT NULL)
      AND p.event_id=? AND json_extract(a.value,'$.userId')=?
      AND json_extract(b.value,'$.endAt')>? AND json_extract(b.value,'$.startAt')<=?
    GROUP BY shift_id ORDER BY shift_start,shift_id
  ) SELECT d.shift_id,d.shift_name,d.shift_start,d.shift_end,d.room_id,d.roles_json,s.id,s.title,s.start_at,s.end_at,
    (SELECT json_group_array(json_object('id',r.id,'name',r.name)) FROM (${publishedRoomsSql}) r
      WHERE r.event_id=s.event_id AND (r.id=s.room_id OR EXISTS(SELECT 1 FROM json_each(s.additional_room_ids_json) x WHERE x.value=r.id))) rooms_json
  FROM duties d JOIN (${publishedSessionsSql}) s ON s.event_id=?
    AND s.start_at<d.shift_end AND s.end_at>d.shift_start AND s.end_at>? AND s.start_at<=?
    AND (d.room_id IS NULL OR d.room_id=s.room_id OR EXISTS(SELECT 1 FROM json_each(s.additional_room_ids_json) x WHERE x.value=d.room_id))
  ORDER BY CASE WHEN s.start_at<=? THEN 0 ELSE 1 END,s.start_at,d.shift_start,d.shift_id,s.id LIMIT 21`,
    [eventId, operatorId, serverTime, horizon, eventId, serverTime, horizon, serverTime],
  );
  const current = await first<{ revision: number }>(
    db,
    "SELECT published_revision AS revision FROM event_agenda_state WHERE event_id=?",
    [eventId],
  );
  if (current?.revision !== publication.revision)
    throw new AppError(
      409,
      "SCANNER_SUGGESTIONS_CHANGED",
      "The published agenda changed. Refresh session suggestions.",
    );
  return scannerSuggestionsResponseSchema.parse({
    serverTime,
    timeZone,
    publishedRevision: publication.revision,
    truncated: rows.length > 20,
    suggestions: rows.slice(0, 20).map((row) => {
      const rooms = JSON.parse(row.rooms_json) as Array<{ id: string; name: string }>;
      return {
        shiftId: row.shift_id,
        shiftName: row.shift_name,
        roles: JSON.parse(row.roles_json),
        startAt: row.shift_start,
        endAt: row.shift_end,
        status: row.shift_start <= serverTime && row.start_at <= serverTime ? "current" : "upcoming",
        occurrence: { id: row.id, title: row.title, startAt: row.start_at, endAt: row.end_at, rooms },
        suggestedRoomId:
          row.room_id && rooms.some((room) => room.id === row.room_id)
            ? row.room_id
            : rooms.length === 1
              ? rooms[0]!.id
              : null,
      };
    }),
  });
}
