import { calendarDatesBetween } from "../../../../assets/shared/timezone";
import type { EventRecord } from "../event-types";

/**
 * The event's days as a CTE named `point_days(day_date,day_label,capacity,position)`:
 * its configured event days, or for an event without them the calendar dates
 * from its start to its end on the event clock. A day reads "Day 1", "Day 2"
 * unless the organizer gave it a label.
 */
export function pointDaysCte(event: Pick<EventRecord, "id" | "starts_at" | "ends_at" | "timezone">) {
  const fallback =
    event.starts_at && event.ends_at ? calendarDatesBetween(event.starts_at, event.ends_at, event.timezone) : [];
  return {
    sql: `point_day_source AS (
 SELECT day_date,NULLIF(TRIM(label),'') AS label,in_person_capacity AS capacity FROM event_days WHERE event_id=?
 UNION ALL SELECT value,NULL,NULL FROM json_each(?) WHERE NOT EXISTS(SELECT 1 FROM event_days WHERE event_id=?)
), point_days AS (
 SELECT day_date,COALESCE(label,'Day '||ROW_NUMBER() OVER(ORDER BY day_date)) AS day_label,capacity,
 ROW_NUMBER() OVER(ORDER BY day_date) AS position FROM point_day_source
)`,
    bindings: [event.id, JSON.stringify(fallback), event.id],
  };
}
