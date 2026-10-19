/** The signed-in attendee's own venue state today, for the event app's home. */
import { eventClockCity } from "../../../../assets/shared/event-clock";
import { currentAttendanceResponseSchema } from "../../../../assets/shared/schemas/event-attendance-points";
import { instantToCalendarDate } from "../../../../assets/shared/timezone";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { effectiveAttendanceSql } from "../event-participation/attendance-corrections";
import { publishedSessionsSql } from "../event-participation/published-schedule";
import type { EventRecord } from "../event-types";
import { pointDaysCte } from "./point-days";
import { venuePresenceChangedAtSql, venuePresenceSql } from "./venue-presence";

export async function currentAttendance(db: DatabaseLike, event: EventRecord, userId: string) {
  const timeZone =
    (
      await first<{ time_zone: string | null }>(
        db,
        "SELECT json_extract(publication.snapshot_json,'$.timeZone') AS time_zone FROM event_agenda_state state JOIN event_agenda_publications publication ON publication.event_id=state.event_id AND publication.revision=state.published_revision WHERE state.event_id=?",
        [event.id],
      )
    )?.time_zone ?? event.timezone;
  const today = instantToCalendarDate(nowIso(), timeZone);
  const days = pointDaysCte(event);
  const [day] = await all<{ day_label: string }>(
    db,
    `WITH ${days.sql} SELECT day_label FROM point_days WHERE day_date=?`,
    [...days.bindings, today],
  );
  const base = { timeZone, clockCity: eventClockCity(event.city) };
  if (!day)
    return currentAttendanceResponseSchema.parse({
      ...base,
      dayDate: null,
      dayLabel: null,
      venue: "none",
      changedAt: null,
      lastSession: null,
    });
  const state = await first<{ presence: "none" | "checked_in" | "checked_out"; changed_at: string | null }>(
    db,
    `SELECT ${venuePresenceSql} AS presence,${venuePresenceChangedAtSql} AS changed_at`,
    [event.id, userId, today, event.id, userId, today],
  );
  const session = await first<{ title: string; observed_at: string }>(
    db,
    `SELECT session.title,o.observed_at FROM event_attendance_observations o
     JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id AND attempt.action<>'checkout'
     JOIN (${publishedSessionsSql}) session ON session.event_id=o.event_id AND session.id=o.occurrence_id
     WHERE o.event_id=? AND o.user_id=? AND o.capture_day_date=? AND o.occurrence_id IS NOT NULL AND ${effectiveAttendanceSql("o")}
     ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 1`,
    [event.id, userId, today],
  );
  return currentAttendanceResponseSchema.parse({
    ...base,
    dayDate: today,
    dayLabel: day.day_label,
    venue: state?.presence ?? "none",
    changedAt: state?.changed_at ?? null,
    lastSession: session ? { title: session.title, checkedInAt: session.observed_at } : null,
  });
}
