import type { DatabaseLike } from "../../types";
import { all } from "../../db/queries";
import { publishedRoomsSql, publishedSessionsSql } from "./published-schedule";

/** Caller must authorize the exact session before resolving management-only people. */
export async function sessionManagementInfo(db: DatabaseLike, occurrenceId: string, canDelegate: boolean) {
  const speakers = await all(
    db,
    "SELECT speaker.user_id AS userId,COALESCE(NULLIF(person.preferred_name,''),NULLIF(TRIM(COALESCE(person.first_name,'')||' '||COALESCE(person.last_name,'')),''),'Speaker') AS displayName FROM event_agenda_occurrence_speakers speaker JOIN users person ON person.id=speaker.user_id WHERE speaker.occurrence_id=? LIMIT 30",
    [occurrenceId],
  );
  const rooms = await all(
    db,
    `SELECT room.id,room.name FROM (${publishedRoomsSql}) room JOIN (${publishedSessionsSql}) session ON session.event_id=room.event_id WHERE session.id=? AND (room.id=session.room_id OR EXISTS(SELECT 1 FROM json_each(session.additional_room_ids_json) selected WHERE selected.value=room.id)) ORDER BY room.name,room.id LIMIT 30`,
    [occurrenceId],
  );
  return { canDelegate, speakers, rooms };
}
