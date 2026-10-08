import type { DatabaseLike, StatementLike } from "../../types";
import { AppError } from "../../errors";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";

/** Validate persisted agendas, including formats inherited by the occurrence insert trigger. */
export interface MeetingAgendaDurationTargets {
  occurrenceIds?: readonly string[];
  agendaUpdatedAt?: string;
}
export function prepareMeetingAgendaDurationGuard(
  db: DatabaseLike,
  seriesId: string,
  targets: MeetingAgendaDurationTargets,
): StatementLike[] {
  const id = uuid(),
    now = nowIso();
  return [
    db
      .prepare(
        `INSERT INTO event_meeting_agenda_write_guards
      (id,series_id,occurrence_id,expected_revision,expected_format_version,expected_write_revision,created_at,duration_valid)
      SELECT ?,?,NULL,0,
        COALESCE((SELECT format_version FROM event_meeting_agenda_state WHERE series_id=?),0),
        COALESCE((SELECT write_revision FROM event_meeting_agenda_state WHERE series_id=?),0),?,
        NOT EXISTS(SELECT 1 FROM event_meeting_occurrence_agendas agenda
          JOIN event_occurrences occurrence ON occurrence.id=agenda.occurrence_id
          WHERE agenda.series_id=? AND occurrence.status='scheduled' AND occurrence.starts_at>?
            AND (occurrence.id IN(SELECT value FROM json_each(?)) OR (? IS NOT NULL AND agenda.updated_at=?))
            AND ROUND((julianday(occurrence.ends_at)-julianday(occurrence.starts_at))*86400000)
                < COALESCE((SELECT SUM(json_extract(item.value,'$.durationMinutes')) FROM json_each(agenda.items_json) item),0)*60000)
    `,
      )
      .bind(
        id,
        seriesId,
        seriesId,
        seriesId,
        now,
        seriesId,
        now,
        JSON.stringify(targets.occurrenceIds ?? []),
        targets.agendaUpdatedAt ?? null,
        targets.agendaUpdatedAt ?? null,
      ),
    db.prepare("DELETE FROM event_meeting_agenda_write_guards WHERE id=?").bind(id),
  ];
}

export function rethrowMeetingAgendaDurationFailure(error: unknown): void {
  if (error instanceof Error && error.message.includes("meeting_agenda_duration_valid"))
    throw new AppError(422, "MEETING_AGENDA_DURATION_EXCEEDED", "Agenda items exceed an affected meeting duration.");
}
