import {
  emptySessionDemandCounts,
  sessionDemandCountsSchema,
  type SessionDemand,
} from "../../../../assets/shared/schemas/event-session-demand";
import { all } from "../../db/queries";
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
    `SELECT participation.occurrence_id,participation.attendance_mode,
      COUNT(DISTINCT CASE WHEN participation.status='reserved' THEN participation.user_id END) AS confirmed,
      COUNT(DISTINCT CASE WHEN participation.status='approval_pending' THEN participation.user_id END) AS pending,
      COUNT(DISTINCT CASE WHEN participation.status='waitlisted' THEN participation.user_id END) AS waitlisted,
      COUNT(DISTINCT CASE WHEN participation.saved=1 OR participation.status='saved' THEN participation.user_id END) AS preferences
    FROM agenda_session_participations participation
    JOIN event_agenda_occurrences occurrence ON occurrence.id=participation.occurrence_id AND occurrence.event_id=participation.event_id
    WHERE participation.event_id=? AND participation.occurrence_id IN(SELECT value FROM json_each(?))
      AND participation.status<>'canceled'
    GROUP BY participation.occurrence_id,participation.attendance_mode LIMIT ?`,
    [eventId, JSON.stringify(occurrenceIds), occurrenceIds.length * 2],
  );
  for (const { occurrence_id, attendance_mode, ...counts } of rows) {
    const selected = demand.get(occurrence_id);
    if (selected) selected[attendance_mode] = sessionDemandCountsSchema.parse(counts);
  }
  return demand;
}
