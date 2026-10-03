import { publishedSessionsSql, publishedRoomsSql } from "./published-schedule";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { sessionParticipationResponseSchema } from "../../../../assets/shared/schemas/event-participation-scanning";
export async function reviewSessionParticipation(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  userId: string,
  decision: "approve" | "reject",
) {
  const published = await first<{ start_at: string | null; timezone: string }>(
    db,
    `SELECT start_at,timezone FROM (${publishedSessionsSql}) WHERE id=? AND event_id=?`,
    [occurrenceId, eventId],
  );
  if (decision === "approve" && !published)
    throw new AppError(404, "SESSION_NOT_PUBLISHED", "This session is not in the approved agenda.");
  const date = published?.start_at ? instantToDateTimeLocal(published.start_at, published.timezone).slice(0, 10) : null;
  const physicalCapacity =
    "CASE WHEN s.capacity IS NULL THEN room.capacity WHEN room.capacity IS NULL THEN s.capacity ELSE MIN(s.capacity,room.capacity) END";
  const result = await db
    .prepare(
      `UPDATE agenda_session_participations AS pending SET status=CASE WHEN ?='reject' THEN 'canceled'
   WHEN pending.attendance_mode='physical' AND (SELECT ${physicalCapacity} FROM (${publishedSessionsSql}) s LEFT JOIN (${publishedRoomsSql}) room ON room.id=s.room_id AND room.event_id=s.event_id WHERE s.id=pending.occurrence_id) IS NOT NULL
   AND (SELECT COUNT(*) FROM (SELECT user_id FROM agenda_session_participations p WHERE p.occurrence_id=pending.occurrence_id AND p.status='reserved' AND p.attendance_mode='physical' AND p.user_id<>pending.user_id UNION SELECT user_id FROM event_session_admissions a WHERE a.occurrence_id=pending.occurrence_id AND a.user_id<>pending.user_id)) >= (SELECT ${physicalCapacity} FROM (${publishedSessionsSql}) s LEFT JOIN (${publishedRoomsSql}) room ON room.id=s.room_id AND room.event_id=s.event_id WHERE s.id=pending.occurrence_id) THEN 'waitlisted'
   WHEN pending.attendance_mode='remote' AND (SELECT remote_capacity FROM (${publishedSessionsSql}) WHERE id=pending.occurrence_id) IS NOT NULL AND (SELECT COUNT(*) FROM agenda_session_participations p WHERE p.occurrence_id=pending.occurrence_id AND p.status='reserved' AND p.attendance_mode='remote' AND p.user_id<>pending.user_id)>=(SELECT remote_capacity FROM (${publishedSessionsSql}) WHERE id=pending.occurrence_id) THEN 'waitlisted' ELSE 'reserved' END,updated_at=?
   WHERE event_id=? AND occurrence_id=? AND user_id=? AND status='approval_pending'
   AND (?='reject' OR EXISTS(SELECT 1 FROM registrations reg WHERE reg.event_id=pending.event_id AND reg.user_id=pending.user_id AND reg.status='registered' AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=reg.id AND day.day_date=?),CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=pending.event_id AND day.day_date=?) THEN 'none' ELSE reg.attendance_type END)=CASE pending.attendance_mode WHEN 'physical' THEN 'in_person' ELSE 'virtual' END))
   AND (?='reject' OR NOT EXISTS(SELECT 1 FROM agenda_session_participations other JOIN (${publishedSessionsSql}) conflict ON conflict.id=other.occurrence_id JOIN (${publishedSessionsSql}) target ON target.id=pending.occurrence_id WHERE other.user_id=pending.user_id AND other.status='reserved' AND other.occurrence_id<>pending.occurrence_id AND conflict.start_at<target.end_at AND conflict.end_at>target.start_at))`,
    )
    .bind(decision, nowIso(), eventId, occurrenceId, userId, decision, date, date, decision)
    .run();
  if (!result.meta?.changes)
    throw new AppError(
      409,
      "SESSION_APPROVAL_CONFLICT",
      "The request changed, registration is no longer valid, or another reservation overlaps.",
    );
  return sessionParticipationResponseSchema.parse(
    await first(
      db,
      "SELECT status,attendance_mode AS attendanceMode FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?",
      [occurrenceId, userId],
    ),
  );
}
