import {
  emptySessionDemandCounts,
  sessionDemandCountsSchema,
  type SessionDemand,
} from "../../../../assets/shared/schemas/event-session-demand";
import { all } from "../../db/queries";
import { sessionDemandAggregateSql } from "./session-demand-query";
import type { DatabaseLike } from "../../types";

/** One bounded grouped read serves the selected agenda page or one room recommendation. */
export async function readSessionDemand(db: DatabaseLike, eventId: string, occurrenceIds: string[]) {
  const demand = new Map<string, SessionDemand>(
    occurrenceIds.map((id) => [id, { physical: emptySessionDemandCounts(), remote: emptySessionDemandCounts() }]),
  );
  if (!occurrenceIds.length) return demand;
  const rows = await all<{
    occurrence_id: string;
    attendance_mode: "physical" | "remote";
    confirmed: number;
    pending: number;
    waitlisted: number;
    preferences: number;
  }>(
    db,
    `${sessionDemandAggregateSql("SELECT id,event_id FROM event_agenda_occurrences WHERE event_id=? AND id IN(SELECT value FROM json_each(?))")} LIMIT ?`,
    [eventId, JSON.stringify(occurrenceIds), occurrenceIds.length * 2],
  );
  for (const { occurrence_id, attendance_mode, ...counts } of rows) {
    const selected = demand.get(occurrence_id);
    if (selected) selected[attendance_mode] = sessionDemandCountsSchema.parse(counts);
  }
  return demand;
}
