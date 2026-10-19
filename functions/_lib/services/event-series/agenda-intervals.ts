import { prepareMeetingAgendaDurationGuard, rethrowMeetingAgendaDurationFailure } from "./agenda-duration";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAgendaScheduleGuard, isAgendaScheduleGuardFailure } from "../event-agenda/schedule-guards";
export function prepareMeetingAgendaIntervals(
  db: DatabaseLike,
  eventId: string,
  seriesId: string,
  updatedAt: string | null = null,
): StatementLike[] {
  return [
    db
      .prepare(
        "DELETE FROM meeting_agenda_speaker_intervals WHERE occurrence_id IN(SELECT occurrence_id FROM event_meeting_occurrence_agendas WHERE series_id=? AND (? IS NULL OR updated_at=?))",
      )
      .bind(seriesId, updatedAt, updatedAt),
    db
      .prepare(
        `INSERT INTO meeting_agenda_speaker_intervals(event_id,occurrence_id,item_id,user_id,start_at,end_at,room_id)
 SELECT ?,agenda.occurrence_id,json_extract(item.value,'$.id'),speaker.value,
 strftime('%Y-%m-%dT%H:%M:%fZ',occurrence.starts_at,'+'||COALESCE((SELECT SUM(json_extract(previous.value,'$.durationMinutes')) FROM json_each(agenda.items_json) previous WHERE CAST(previous.key AS INTEGER)<CAST(item.key AS INTEGER)),0)||' minutes'),
 strftime('%Y-%m-%dT%H:%M:%fZ',occurrence.starts_at,'+'||(COALESCE((SELECT SUM(json_extract(previous.value,'$.durationMinutes')) FROM json_each(agenda.items_json) previous WHERE CAST(previous.key AS INTEGER)<CAST(item.key AS INTEGER)),0)+json_extract(item.value,'$.durationMinutes'))||' minutes'),NULL
 FROM event_meeting_occurrence_agendas agenda JOIN event_occurrences occurrence ON occurrence.id=agenda.occurrence_id
 JOIN json_each(agenda.items_json) item JOIN json_each(json_extract(item.value,'$.speakerUserIds')) speaker
 WHERE agenda.series_id=? AND (? IS NULL OR agenda.updated_at=?) AND occurrence.status='scheduled'`,
      )
      .bind(eventId, seriesId, updatedAt, updatedAt),
  ];
}

export function prepareMeetingAgendaSchedule(
  db: DatabaseLike,
  eventId: string,
  seriesId: string,
  occurrenceIds: readonly string[] = [],
): StatementLike[] {
  return [
    ...prepareMeetingAgendaDurationGuard(db, seriesId, { occurrenceIds }),
    ...prepareMeetingAgendaIntervals(db, eventId, seriesId),
    ...prepareAgendaScheduleGuard(db, eventId),
  ];
}

/** Recognize meeting schedule refusals without reinterpreting unrelated persistence failures. */
export function rethrowMeetingAgendaScheduleFailure(error: unknown): void {
  rethrowMeetingAgendaDurationFailure(error);
  if (isAgendaScheduleGuardFailure(error))
    throw new AppError(409, "AGENDA_SCHEDULE_CONFLICT", "A speaker has another scheduled commitment at this time.");
}
