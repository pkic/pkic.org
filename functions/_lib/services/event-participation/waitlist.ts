import { operationalAllocationCompatibleSql } from "./session-allocation";
import { physicalAllocationAvailableSql } from "./session-allocation";
import { prepareBookingNotification } from "./booking-notifications";
import { preparePersonalCalendarEntries } from "./calendar-entries";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { physicalOccupiedSql, remoteOccupiedSql } from "./capacity-accounting";
import { publishedRoomsSql, publishedSessionsSql } from "./published-schedule";

/** Bounded FIFO work. Every allocation rechecks eligibility and capacity in its own write. */
export async function promoteSessionWaitlist(db: DatabaseLike, eventId: string, limit = 100) {
  const candidates = await all<{
    id: string;
    occurrence_id: string;
    user_id: string;
    start_at: string | null;
    timezone: string;
  }>(
    db,
    `SELECT p.id,p.occurrence_id,p.user_id,s.start_at,s.timezone
    FROM agenda_session_participations p JOIN (${publishedSessionsSql}) s ON s.id=p.occurrence_id AND s.event_id=p.event_id
    WHERE p.event_id=? AND p.status='waitlisted' AND s.admission_policy<>'preference' AND (s.admission_policy<>'approval' OR p.approval_state='approved')
    AND (s.booking_opens_at IS NULL OR s.booking_opens_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND (s.booking_closes_at IS NULL OR s.booking_closes_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    AND (s.access_policy='open' OR EXISTS(SELECT 1 FROM agenda_session_invitations invite WHERE invite.occurrence_id=s.id AND invite.user_id=p.user_id AND invite.revoked_at IS NULL))
    AND ${operationalAllocationCompatibleSql("p.occurrence_id", "p.user_id", "p.attendance_mode", "p.room_id")}
    AND (p.attendance_mode='physical' AND (${physicalAllocationAvailableSql("s", "p.room_id", "p.user_id")}) OR p.attendance_mode='remote' AND (s.remote_capacity IS NULL OR ${remoteOccupiedSql("s.id", "p.user_id")}<s.remote_capacity))
    AND EXISTS(SELECT 1 FROM registrations reg JOIN users person ON person.id=reg.user_id AND person.active=1 WHERE reg.event_id=p.event_id AND reg.user_id=p.user_id AND reg.status='registered' AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=reg.id AND day.day_date=p.attendance_day_date),CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=p.event_id AND day.day_date=p.attendance_day_date) THEN 'none' ELSE reg.attendance_type END)=CASE p.attendance_mode WHEN 'physical' THEN 'in_person' ELSE 'virtual' END)
    AND NOT EXISTS(SELECT 1 FROM agenda_session_participations other JOIN (${publishedSessionsSql}) conflict ON conflict.id=other.occurrence_id WHERE other.user_id=p.user_id AND other.status='reserved' AND other.occurrence_id<>p.occurrence_id AND conflict.start_at<s.end_at AND conflict.end_at>s.start_at)
    ORDER BY COALESCE(p.waitlisted_at,p.created_at),p.id LIMIT ?`,
    [eventId, Math.min(Math.max(limit, 1), 500)],
  );
  let promoted = 0;
  for (const candidate of candidates) {
    if (!candidate.start_at) continue;
    const day = instantToDateTimeLocal(candidate.start_at, candidate.timezone).slice(0, 10);
    const statement = db
      .prepare(
        `UPDATE agenda_session_participations AS waiting SET allocation_revision=allocation_revision+1,status='reserved',updated_at=?
      WHERE waiting.id=? AND waiting.status='waitlisted'
      AND EXISTS(SELECT 1 FROM (${publishedSessionsSql}) s LEFT JOIN (${publishedRoomsSql}) room ON room.id=s.room_id AND room.event_id=s.event_id
        WHERE s.id=waiting.occurrence_id AND s.event_id=waiting.event_id AND s.admission_policy<>'preference' AND s.start_at=? AND s.timezone=?
        AND (s.booking_opens_at IS NULL OR s.booking_opens_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND (s.booking_closes_at IS NULL OR s.booking_closes_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        AND (s.access_policy='open' OR EXISTS(SELECT 1 FROM agenda_session_invitations invite WHERE invite.occurrence_id=s.id AND invite.user_id=waiting.user_id AND invite.revoked_at IS NULL))
        AND (s.admission_policy<>'approval' OR waiting.approval_state='approved')
        AND ${operationalAllocationCompatibleSql("waiting.occurrence_id", "waiting.user_id", "waiting.attendance_mode", "waiting.room_id")}
        AND (waiting.attendance_mode='physical' AND (${physicalAllocationAvailableSql("s", "waiting.room_id", "waiting.user_id")})
          OR waiting.attendance_mode='remote' AND (s.remote_capacity IS NULL OR ${remoteOccupiedSql("s.id", "waiting.user_id")}<s.remote_capacity))
        AND NOT EXISTS(SELECT 1 FROM agenda_session_participations other JOIN (${publishedSessionsSql}) conflict ON conflict.id=other.occurrence_id
          WHERE other.user_id=waiting.user_id AND other.status='reserved' AND other.occurrence_id<>waiting.occurrence_id AND conflict.start_at<s.end_at AND conflict.end_at>s.start_at))
      AND EXISTS(SELECT 1 FROM registrations reg JOIN users person ON person.id=reg.user_id AND person.active=1 WHERE reg.event_id=waiting.event_id AND reg.user_id=waiting.user_id AND reg.status='registered'
        AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=reg.id AND day.day_date=?),
          CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=waiting.event_id AND day.day_date=?) THEN 'none' ELSE reg.attendance_type END)=CASE waiting.attendance_mode WHEN 'physical' THEN 'in_person' ELSE 'virtual' END)
      AND NOT EXISTS(SELECT 1 FROM agenda_session_participations earlier WHERE earlier.occurrence_id=waiting.occurrence_id AND earlier.attendance_mode=waiting.attendance_mode AND (earlier.attendance_mode='remote' OR earlier.room_id IS waiting.room_id OR EXISTS(SELECT 1 FROM (${publishedSessionsSql}) earlier_pool WHERE earlier_pool.id=earlier.occurrence_id AND earlier_pool.capacity IS NOT NULL AND ${physicalOccupiedSql("earlier_pool.id", "waiting.user_id")}>=earlier_pool.capacity)) AND earlier.status='waitlisted'
        AND (COALESCE(earlier.waitlisted_at,earlier.created_at)<COALESCE(waiting.waitlisted_at,waiting.created_at)
          OR COALESCE(earlier.waitlisted_at,earlier.created_at)=COALESCE(waiting.waitlisted_at,waiting.created_at) AND earlier.id<waiting.id)
        AND EXISTS(SELECT 1 FROM (${publishedSessionsSql}) earlier_session WHERE earlier_session.id=earlier.occurrence_id AND (earlier_session.admission_policy<>'approval' OR earlier.approval_state='approved') AND (earlier_session.access_policy='open' OR EXISTS(SELECT 1 FROM agenda_session_invitations invite WHERE invite.occurrence_id=earlier_session.id AND invite.user_id=earlier.user_id AND invite.revoked_at IS NULL)))
        AND EXISTS(SELECT 1 FROM registrations active JOIN users earlier_user ON earlier_user.id=active.user_id AND earlier_user.active=1 WHERE active.event_id=earlier.event_id AND active.user_id=earlier.user_id AND active.status='registered'
          AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=active.id AND day.day_date=?),
            CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=earlier.event_id AND day.day_date=?) THEN 'none' ELSE active.attendance_type END)=CASE earlier.attendance_mode WHEN 'physical' THEN 'in_person' ELSE 'virtual' END)
        AND NOT EXISTS(SELECT 1 FROM agenda_session_participations other JOIN (${publishedSessionsSql}) conflict ON conflict.id=other.occurrence_id JOIN (${publishedSessionsSql}) target ON target.id=earlier.occurrence_id
          WHERE other.user_id=earlier.user_id AND other.status='reserved' AND other.occurrence_id<>earlier.occurrence_id AND conflict.start_at<target.end_at AND conflict.end_at>target.start_at))`,
      )
      .bind(nowIso(), candidate.id, candidate.start_at, candidate.timezone, day, day, day, day);
    const [result] = await db.batch([
      statement,
      ...preparePersonalCalendarEntries(db, eventId, candidate.user_id),
      prepareBookingNotification(db, eventId, candidate.occurrence_id, candidate.user_id, true),
    ]);
    promoted += result.meta?.changes ?? 0;
  }
  return { inspected: candidates.length, promoted };
}
