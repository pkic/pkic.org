import { agendaOccurrencePersonConflictSql } from "./schedule-guards";
import { agendaConflictCategorySchema } from "../../../../assets/shared/schemas/event-agenda";
/** Existence only: another event's titles, locations and people never leave the database. */
export function agendaOccurrenceConflictSql(alias = "event_agenda_occurrences") {
  const placement = (room: string, occurrence: string) =>
    `(${room}.id=${occurrence}.room_id OR EXISTS(SELECT 1 FROM event_agenda_occurrence_rooms placement WHERE placement.occurrence_id=${occurrence}.id AND placement.room_id=${room}.id))`;
  const roomPair = `FROM event_agenda_rooms room JOIN event_agenda_occurrences other ON other.event_id=${alias}.event_id AND other.id<>${alias}.id
    WHERE room.event_id=${alias}.event_id AND ${placement("room", alias)} AND ${placement("room", "other")} AND other.start_at IS NOT NULL`;
  const overlap = `julianday(${alias}.start_at)<julianday(other.end_at) AND julianday(other.start_at)<julianday(${alias}.end_at)`;
  const gap = `MAX(julianday(${alias}.start_at)-julianday(other.end_at),julianday(other.start_at)-julianday(${alias}.end_at))*1440.0`;
  const expressions = {
    room_overlap: `EXISTS(SELECT 1 ${roomPair} AND ${overlap})`,
    room_setup: `EXISTS(SELECT 1 ${roomPair} AND NOT(${overlap}) AND ${gap}<room.setup_minutes-0.000001)`,
    room_unavailable: `EXISTS(SELECT 1 FROM event_agenda_rooms room WHERE room.event_id=${alias}.event_id AND ${placement("room", alias)}
      AND json_array_length(room.available_periods_json)>0 AND NOT EXISTS(SELECT 1 FROM json_each(room.available_periods_json) period
        WHERE julianday(json_extract(period.value,'$.startAt'))<=julianday(${alias}.start_at)
          AND julianday(${alias}.end_at)+room.setup_minutes/1440.0<=julianday(json_extract(period.value,'$.endAt'))))`,
    ...agendaOccurrencePersonConflictSql(alias),
    speaker_meeting_conflict: `EXISTS(SELECT 1 FROM event_agenda_occurrence_speakers person JOIN meeting_agenda_speaker_intervals busy ON busy.user_id=person.user_id
      LEFT JOIN event_agenda_state local_state ON local_state.event_id=${alias}.event_id
      LEFT JOIN event_agenda_state busy_state ON busy_state.event_id=busy.event_id
      WHERE person.occurrence_id=${alias}.id
        AND julianday(${alias}.start_at)<julianday(busy.end_at)+CASE WHEN person.attendance_mode='physical' AND (${alias}.event_id<>busy.event_id OR COALESCE(person.room_id,${alias}.room_id) IS NOT busy.room_id) THEN MAX(COALESCE(local_state.travel_minutes,0),COALESCE(busy_state.travel_minutes,0))/1440.0 ELSE 0 END
        AND julianday(busy.start_at)<julianday(${alias}.end_at)+CASE WHEN person.attendance_mode='physical' AND (${alias}.event_id<>busy.event_id OR COALESCE(person.room_id,${alias}.room_id) IS NOT busy.room_id) THEN MAX(COALESCE(local_state.travel_minutes,0),COALESCE(busy_state.travel_minutes,0))/1440.0 ELSE 0 END)`,
  };
  const categories = agendaConflictCategorySchema.options;
  const active = `${alias}.start_at IS NOT NULL`;
  return {
    any: `(${active} AND (${categories.map((category) => expressions[category]).join(" OR ")}))`,
    projection: categories.map((category) => `(${active} AND ${expressions[category]}) AS ${category}`).join(","),
  };
}
