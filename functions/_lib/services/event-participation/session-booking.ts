import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../../../../assets/shared/schemas/event-participation-scanning";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { publishedSessionsSql, publishedRoomsSql } from "./published-schedule";
import { AppError } from "../../errors";

/** One guarded write owns registration, attendance mode, overlap and last-seat allocation. */
export async function setSessionParticipation(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  userId: string,
  raw: unknown,
) {
  const input = sessionParticipationRequestSchema.parse(raw);
  const session = await first<{ admission_policy: string; start_at: string | null; timezone: string }>(
    db,
    `SELECT s.admission_policy,s.start_at,s.timezone FROM (${publishedSessionsSql}) s WHERE s.id=? AND s.event_id=?`,
    [occurrenceId, eventId],
  );
  if (!session) throw new AppError(404, "SESSION_NOT_FOUND", "Session not found.");
  if (input.action === "request" && session.admission_policy !== "approval")
    throw new AppError(409, "APPROVAL_NOT_REQUIRED", "This session does not require approval.");
  const target =
    input.action === "cancel"
      ? "canceled"
      : input.action === "save"
        ? "saved"
        : session.admission_policy === "approval"
          ? "approval_pending"
          : "reserved";
  const date = session.start_at ? instantToDateTimeLocal(session.start_at, session.timezone).slice(0, 10) : null;
  const capacity =
    input.attendanceMode === "remote"
      ? "s.remote_capacity"
      : "CASE WHEN s.capacity IS NULL THEN room.capacity WHEN room.capacity IS NULL THEN s.capacity ELSE MIN(s.capacity,room.capacity) END";
  const occupied =
    input.attendanceMode === "remote"
      ? "(SELECT COUNT(*) FROM agenda_session_participations p WHERE p.occurrence_id=s.id AND p.status='reserved' AND p.attendance_mode='remote' AND p.user_id<>? AND p.user_id<>?)"
      : "(SELECT COUNT(*) FROM (SELECT p.user_id FROM agenda_session_participations p WHERE p.occurrence_id=s.id AND p.status='reserved' AND p.attendance_mode='physical' AND p.user_id<>? UNION SELECT a.user_id FROM event_session_admissions a WHERE a.occurrence_id=s.id AND a.user_id<>?))";
  const now = nowIso();
  const result = await db
    .prepare(
      `INSERT INTO agenda_session_participations (id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at)
 SELECT ?,s.event_id,s.id,?,?,CASE WHEN ?='reserved' AND ? IN ('physical','remote') AND ${capacity} IS NOT NULL AND ${occupied}>=${capacity} THEN 'waitlisted' ELSE ? END,?,?
 FROM (${publishedSessionsSql}) s LEFT JOIN (${publishedRoomsSql}) room ON room.id=s.room_id AND room.event_id=s.event_id
 WHERE s.id=? AND s.event_id=? AND s.start_at IS ? AND s.timezone=? AND s.admission_policy=?
 AND (s.visibility='public' OR EXISTS(SELECT 1 FROM agenda_session_participations access WHERE access.occurrence_id=s.id AND access.user_id=? AND access.status IN ('reserved','approval_pending')))
 AND (? IN ('save','cancel') OR EXISTS(SELECT 1 FROM registrations reg WHERE reg.event_id=s.event_id AND reg.user_id=? AND reg.status='registered'
   AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=reg.id AND day.day_date=?),
     CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=s.event_id AND day.day_date=?) THEN 'none' ELSE reg.attendance_type END)=?))
 AND (?<>'reserved' OR NOT EXISTS(SELECT 1 FROM agenda_session_participations other JOIN (${publishedSessionsSql}) time ON time.id=other.occurrence_id
   WHERE other.user_id=? AND other.status='reserved' AND other.occurrence_id<>s.id AND time.start_at<s.end_at AND time.end_at>s.start_at))
 AND NOT (?='reserved' AND ? IN ('physical','remote') AND ${capacity} IS NOT NULL AND ${occupied}>=${capacity} AND EXISTS(SELECT 1 FROM agenda_session_participations prior WHERE prior.occurrence_id=s.id AND prior.user_id=? AND prior.status='reserved' AND prior.attendance_mode<>?))
 ON CONFLICT(occurrence_id,user_id) DO UPDATE SET attendance_mode=excluded.attendance_mode,status=excluded.status,updated_at=excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      input.attendanceMode,
      target,
      input.attendanceMode,
      userId,
      userId,
      target,
      now,
      now,
      occurrenceId,
      eventId,
      session.start_at,
      session.timezone,
      session.admission_policy,
      userId,
      input.action,
      userId,
      date,
      date,
      input.attendanceMode === "physical" ? "in_person" : "virtual",
      target,
      userId,
      target,
      input.attendanceMode,
      userId,
      userId,
      userId,
      input.attendanceMode,
    )
    .run();
  if (!result.meta?.changes)
    throw new AppError(
      409,
      "SESSION_PARTICIPATION_CONFLICT",
      "Check your event registration, attendance mode, session access, or overlapping reservations. Your existing reservation has been preserved.",
    );
  const row = await first(
    db,
    "SELECT status,attendance_mode AS attendanceMode FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?",
    [occurrenceId, userId],
  );
  return sessionParticipationResponseSchema.parse(row);
}
