import {
  MEETING_CALENDAR_OCCURRENCE_LIMIT,
  meetingCalendarThrough,
} from "../../../../assets/shared/meeting-calendar-policy";
import { all } from "../../db/queries";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { expandStarts } from "./recurrence-expansion";

/** Retain historical exceptions when updating the recurring master. */
export const CALENDAR_OCCURRENCE_WINDOW_SQL = `(occurrence.ends_at >= ?
  OR occurrence.status = 'cancelled'
  OR occurrence.starts_at != COALESCE(occurrence.recurrence_id, occurrence.starts_at)
  OR occurrence.location_override IS NOT NULL
  OR unixepoch(occurrence.ends_at) - unixepoch(occurrence.starts_at) != series.duration_minutes * 60)`;

export interface CalendarSchedule {
  id: string;
  eventId: string;
  startsAt: string;
  recurrenceRule: string;
  timezone: string;
  durationMinutes: number;
}

export function prepareCalendarRevision(db: DatabaseLike, seriesId: string): StatementLike[] {
  return [
    db.prepare("UPDATE event_series SET calendar_revision = calendar_revision + 1 WHERE id = ?").bind(seriesId),
    db.prepare("UPDATE scheduled_jobs SET wake_requested = 1 WHERE job_key = 'meeting_invitations'"),
  ];
}

/** Persist the schedule and its delivery revision in the caller's atomic command. */
export function prepareCalendarSchedule(db: DatabaseLike, series: CalendarSchedule, now = nowIso()): StatementLike[] {
  const through = meetingCalendarThrough(series.startsAt, series.timezone, now);
  const from = new Date(Date.parse(now) - 30 * 86400_000).toISOString();
  const starts = expandStarts(
    series.startsAt,
    series.timezone,
    series.recurrenceRule,
    through,
    MEETING_CALENDAR_OCCURRENCE_LIMIT,
    from,
  );
  const rows = starts.map((startsAt) => ({
    id: uuid(),
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + series.durationMinutes * 60_000).toISOString(),
  }));
  return [
    db
      .prepare(
        `INSERT OR IGNORE INTO event_occurrences
      (id, series_id, starts_at, recurrence_id, ends_at, status, created_at, updated_at)
      SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.startsAt'), json_extract(value, '$.startsAt'),
             json_extract(value, '$.endsAt'), 'scheduled', ?, ? FROM json_each(?)
      WHERE NOT EXISTS (SELECT 1 FROM event_occurrences old WHERE old.series_id = ?
        AND COALESCE(old.recurrence_id, old.starts_at) = json_extract(value, '$.startsAt'))`,
      )
      .bind(series.id, now, now, JSON.stringify(rows), series.id),
    db
      .prepare(
        `UPDATE event_series SET calendar_through = ?, calendar_checked_at = ?,
      calendar_revision = calendar_revision + CASE WHEN calendar_through IS NULL OR calendar_through < ? THEN 1 ELSE 0 END
      WHERE id = ?`,
      )
      .bind(through, now, through, series.id),
    db
      .prepare(
        `UPDATE events SET starts_at = (SELECT MIN(starts_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled'),
      ends_at = (SELECT MAX(ends_at) FROM event_occurrences WHERE series_id = ? AND status != 'cancelled') WHERE id = ?`,
      )
      .bind(series.id, series.id, series.eventId),
    db.prepare("UPDATE scheduled_jobs SET wake_requested = 1 WHERE job_key = 'meeting_invitations'"),
  ];
}

/** Revisit a bounded number of active schedules daily, including old empty series. */
export async function renewMeetingCalendars(db: DatabaseLike, seriesId?: string, now = nowIso()): Promise<void> {
  const cutoff = new Date(Date.parse(now) - 86400_000).toISOString();
  const rows = await all<CalendarSchedule & { revision: number }>(
    db,
    `SELECT id, event_id AS eventId, starts_at AS startsAt,
    recurrence_rule AS recurrenceRule, timezone, duration_minutes AS durationMinutes, calendar_revision AS revision
    FROM event_series WHERE active = 1 AND (? IS NULL OR id = ?)
    AND (calendar_checked_at IS NULL OR calendar_checked_at < ?) ORDER BY calendar_checked_at, id LIMIT 5`,
    [seriesId ?? null, seriesId ?? null, cutoff],
  );
  for (const series of rows) {
    await db.batch([
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM event_series WHERE id = ? AND calendar_revision = ? AND active = 1",
        bindings: [series.id, series.revision],
      }),
      ...prepareCalendarSchedule(db, series, now),
    ]);
  }
}
