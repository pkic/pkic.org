import { eventReadIdSql, type EventReadSelection } from "../events/selection";

/** Trusted backend selection shared by page details, credited speakers, sponsors, and demand. */
export interface AgendaOccurrenceSelection {
  sql: string;
  bindings: readonly unknown[];
}

export function agendaOccurrenceSelection(
  event: EventReadSelection,
  ids?: string[] | AgendaOccurrenceSelection,
): AgendaOccurrenceSelection {
  if (ids && !Array.isArray(ids)) return ids;
  const scope = eventReadIdSql(event);
  const requested = ids === undefined ? null : JSON.stringify(ids);
  return {
    sql: `SELECT id FROM event_agenda_occurrences WHERE event_id=${scope.sql}
      AND (? IS NULL OR id IN(SELECT value FROM json_each(?))) ORDER BY start_at,id LIMIT 2001`,
    bindings: [...scope.bindings, requested, requested],
  };
}
