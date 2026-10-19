import { prepareEventBookingNotifications } from "./booking-notifications";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { publishedSessionsSql } from "./published-schedule";
import { preparePersonalCalendarEntries } from "./calendar-entries";
import { promoteSessionWaitlist } from "./waitlist";
export function prepareParticipationWork(db: DatabaseLike, eventId: string) {
  return db
    .prepare(
      "INSERT INTO agenda_participation_jobs(event_id,requested_at) VALUES(?,?) ON CONFLICT(event_id) DO UPDATE SET requested_at=excluded.requested_at",
    )
    .bind(eventId, nowIso());
}
/** Revoke stale seat claims; physical attendance evidence and unsurrendered offline rights remain intact. */
export async function reconcileEventParticipations(
  db: DatabaseLike,
  eventId: string,
  limit = 100,
  cursor?: { updatedAt: string; id: string },
) {
  const rows = await all<{ id: string; updated_at: string; start_at: string | null; timezone: string }>(
    db,
    `SELECT p.id,p.updated_at,s.start_at,s.timezone FROM agenda_session_participations p LEFT JOIN (${publishedSessionsSql}) s ON s.id=p.occurrence_id AND s.event_id=p.event_id
   WHERE p.event_id=? AND p.status IN ('reserved','approval_pending','waitlisted') AND (? IS NULL OR p.updated_at>? OR p.updated_at=? AND p.id>?) ORDER BY p.updated_at,p.id LIMIT ?`,
    [
      eventId,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.updatedAt ?? null,
      cursor?.id ?? null,
      Math.min(Math.max(limit, 1), 500),
    ],
  );
  let canceled = 0;
  for (const row of rows) {
    const day = row.start_at ? instantToDateTimeLocal(row.start_at, row.timezone).slice(0, 10) : null;
    const result = await db
      .prepare(
        `UPDATE agenda_session_participations AS claim SET status='canceled',allocation_revision=allocation_revision+1,updated_at=? WHERE id=? AND status IN ('reserved','approval_pending','waitlisted')
   AND (NOT EXISTS(SELECT 1 FROM (${publishedSessionsSql}) s WHERE s.id=claim.occurrence_id AND s.event_id=claim.event_id)
    OR NOT EXISTS(SELECT 1 FROM registrations reg JOIN users person ON person.id=reg.user_id WHERE reg.event_id=claim.event_id AND reg.user_id=claim.user_id AND reg.status='registered' AND person.active=1
      AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=reg.id AND day.day_date=?),
       CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=claim.event_id AND day.day_date=?) THEN 'none' ELSE reg.attendance_type END)=CASE claim.attendance_mode WHEN 'physical' THEN 'in_person' ELSE 'virtual' END))`,
      )
      .bind(nowIso(), row.id, day, day)
      .run();
    canceled += result.meta?.changes ?? 0;
  }
  await db.batch([...preparePersonalCalendarEntries(db, eventId), prepareEventBookingNotifications(db, eventId)]);
  return { inspected: rows.length, canceled, cursor: rows.length === limit ? rows.at(-1) : undefined };
}
export async function runAgendaParticipationDueWork(db: DatabaseLike, eventLimit = 10) {
  const events = await all<{ event_id: string; cursor_updated_at: string | null; cursor_id: string | null }>(
    db,
    "SELECT event_id,cursor_updated_at,cursor_id FROM agenda_participation_jobs ORDER BY COALESCE(last_checked_at,requested_at),event_id LIMIT ?",
    [Math.min(Math.max(eventLimit, 1), 100)],
  );
  let promoted = 0,
    canceled = 0;
  for (const event of events) {
    const reconciliation = await reconcileEventParticipations(
      db,
      event.event_id,
      100,
      event.cursor_updated_at && event.cursor_id
        ? { updatedAt: event.cursor_updated_at, id: event.cursor_id }
        : undefined,
    );
    canceled += reconciliation.canceled;
    const promotion = await promoteSessionWaitlist(db, event.event_id);
    promoted += promotion.promoted;
    await db.batch([
      ...preparePersonalCalendarEntries(db, event.event_id),
      db
        .prepare(
          "UPDATE agenda_participation_jobs SET last_checked_at=?,cursor_updated_at=?,cursor_id=? WHERE event_id=?",
        )
        .bind(nowIso(), reconciliation.cursor?.updated_at ?? null, reconciliation.cursor?.id ?? null, event.event_id),
    ]);
  }
  return { events: events.length, promoted, canceled };
}

/** Set-based mutation hook; persisted venue-day identities avoid UTC-date mistakes near midnight. */
export function prepareParticipationReconciliation(db: DatabaseLike, eventId: string, userId?: string) {
  const values = userId ? [eventId, userId] : [eventId];
  const now = nowIso();
  return [
    db
      .prepare(
        `UPDATE agenda_session_participations AS claim SET status='canceled',allocation_revision=allocation_revision+1,updated_at=? WHERE event_id=? ${userId ? "AND user_id=?" : ""} AND status IN ('reserved','approval_pending','waitlisted')
   AND (NOT EXISTS(SELECT 1 FROM (${publishedSessionsSql}) s WHERE s.id=claim.occurrence_id AND s.event_id=claim.event_id)
   OR NOT EXISTS(SELECT 1 FROM registrations reg JOIN users person ON person.id=reg.user_id WHERE reg.event_id=claim.event_id AND reg.user_id=claim.user_id AND reg.status='registered' AND person.active=1
    AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=reg.id AND day.day_date=claim.attendance_day_date),
      CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=claim.event_id AND day.day_date=claim.attendance_day_date) THEN 'none' ELSE reg.attendance_type END)=CASE claim.attendance_mode WHEN 'physical' THEN 'in_person' ELSE 'virtual' END))`,
      )
      .bind(now, ...values),
    ...preparePersonalCalendarEntries(db, eventId, userId),
    prepareEventBookingNotifications(db, eventId, userId),
    prepareParticipationWork(db, eventId),
  ];
}
