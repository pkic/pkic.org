import type { DatabaseLike } from "../../types";
/** Replace normalized additional physical room reservations in the same guarded agenda revision. */
export function agendaAdditionalRoomStatements(db: DatabaseLike, occurrenceId: string, roomIds: readonly string[]) {
  return [
    db.prepare("DELETE FROM event_agenda_occurrence_rooms WHERE occurrence_id=?").bind(occurrenceId),
    db
      .prepare("INSERT INTO event_agenda_occurrence_rooms(occurrence_id,room_id) SELECT ?,value FROM json_each(?)")
      .bind(occurrenceId, JSON.stringify(roomIds)),
  ];
}
