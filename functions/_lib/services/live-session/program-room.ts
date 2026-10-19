import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { utcInstantSchema } from "../../../../assets/shared/schemas/api-common";
/** The stable physical location and program window are taken only from the approved revision. */
export async function readPublishedProgramRoom(db: DatabaseLike, eventId: string, roomId: string) {
  const row = await first<{
    id: string;
    name: string;
    starts_at: string | null;
    ends_at: string | null;
    first_start: string | null;
    last_end: string | null;
  }>(
    db,
    `SELECT json_extract(room.value,'$.id') AS id,json_extract(room.value,'$.name') AS name,event.starts_at,event.ends_at,
    (SELECT MIN(json_extract(session.payload_json,'$.startAt')) FROM event_agenda_published_occurrences session WHERE session.event_id=state.event_id AND session.revision=state.published_revision AND json_extract(session.payload_json,'$.kind')<>'break' AND (json_extract(session.payload_json,'$.roomId')=? OR EXISTS(SELECT 1 FROM json_each(session.payload_json,'$.additionalRoomIds') extra WHERE extra.value=?))) AS first_start,
    (SELECT MAX(json_extract(session.payload_json,'$.endAt')) FROM event_agenda_published_occurrences session WHERE session.event_id=state.event_id AND session.revision=state.published_revision AND json_extract(session.payload_json,'$.kind')<>'break' AND (json_extract(session.payload_json,'$.roomId')=? OR EXISTS(SELECT 1 FROM json_each(session.payload_json,'$.additionalRoomIds') extra WHERE extra.value=?))) AS last_end
    FROM event_agenda_state state JOIN event_agenda_publications publication ON publication.event_id=state.event_id AND publication.revision=state.published_revision JOIN events event ON event.id=state.event_id JOIN json_each(publication.snapshot_json,'$.rooms') room
    WHERE state.event_id=? AND json_extract(room.value,'$.id')=?`,
    [roomId, roomId, roomId, roomId, eventId, roomId],
  );
  if (!row) throw new AppError(404, "LIVE_PROGRAM_ROOM_NOT_FOUND", "This physical room is not on the approved agenda.");
  const bounded =
    [row.starts_at, row.ends_at, row.first_start, row.last_end].every(
      (value) => utcInstantSchema.safeParse(value).success,
    ) &&
    row.first_start! >= row.starts_at! &&
    row.last_end! <= row.ends_at!;
  return {
    id: row.id,
    name: row.name,
    firstStartAt: bounded ? row.first_start : null,
    lastEndAt: bounded ? row.last_end : null,
    lastScheduledEndAt: utcInstantSchema.safeParse(row.last_end).success ? row.last_end : null,
  };
}
