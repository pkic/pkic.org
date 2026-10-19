/** Archived starts support display ordering only; no ending or bookable interval is inferred. */
export const agendaOccurrenceDisplayStartSql = `CASE WHEN event_agenda_occurrences.start_at IS NULL AND event_agenda_occurrences.end_at IS NULL
 THEN (SELECT json_extract(history.metadata_json,'$.archivalTiming.startAt') FROM event_agenda_session_history history WHERE history.occurrence_id=event_agenda_occurrences.id)
 ELSE event_agenda_occurrences.start_at END`;
export const agendaOccurrenceConflictCoverageSql = `CASE
 WHEN EXISTS(SELECT 1 FROM event_agenda_session_history history WHERE history.occurrence_id=event_agenda_occurrences.id AND json_array_length(history.metadata_json,'$.archivalCredits')>0) THEN 'incomplete'
 WHEN event_agenda_occurrences.start_at IS NULL OR event_agenda_occurrences.end_at IS NULL THEN 'not_scheduled'
 ELSE 'complete' END`;
