import {
  emptySessionDemandCounts,
  sessionDemandCountsSchema,
  type SessionDemand,
} from "../../../../assets/shared/schemas/event-session-demand";
import { batchRows } from "../../db/pagination";
import { sessionDemandAggregateSql } from "./session-demand-query";
import type { DatabaseLike, D1StatementResult } from "../../types";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import type { AgendaOccurrenceSelection } from "../event-agenda/occurrence-selection";

export function prepareSessionDemand(
  db: DatabaseLike,
  event: EventReadSelection,
  selection: AgendaOccurrenceSelection,
  limit = 2001,
) {
  const scope = eventReadIdSql(event);
  return {
    statements: [
      db
        .prepare(
          `${sessionDemandAggregateSql(`SELECT id,event_id FROM event_agenda_occurrences WHERE event_id=${scope.sql} AND id IN(${selection.sql})`)} LIMIT ?`,
        )
        .bind(...scope.bindings, ...selection.bindings, limit * 2),
    ],
    decode(results: D1StatementResult[], occurrenceIds: string[]) {
      const demand = new Map<string, SessionDemand>(
        occurrenceIds.map((id) => [id, { physical: emptySessionDemandCounts(), remote: emptySessionDemandCounts() }]),
      );
      for (const { occurrence_id, attendance_mode, ...counts } of batchRows<{
        occurrence_id: string;
        attendance_mode: "physical" | "remote";
        confirmed: number;
        pending: number;
        waitlisted: number;
        preferences: number;
      }>(results[0])) {
        const selected = demand.get(occurrence_id);
        if (selected) selected[attendance_mode] = sessionDemandCountsSchema.parse(counts);
      }
      return demand;
    },
  };
}

/** One bounded grouped read serves the selected agenda page or one room recommendation. */
export async function readSessionDemand(db: DatabaseLike, eventId: string, occurrenceIds: string[]) {
  if (!occurrenceIds.length) return new Map<string, SessionDemand>();
  const read = prepareSessionDemand(
    db,
    eventId,
    { sql: "SELECT value AS id FROM json_each(?)", bindings: [JSON.stringify(occurrenceIds)] },
    occurrenceIds.length,
  );
  return read.decode(await db.batch(read.statements), occurrenceIds);
}
