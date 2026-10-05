import { operationalAllocationCompatibleSql } from "./session-allocation";
import { physicalAllocationAvailableSql, physicalRoomEligibleSql } from "./session-allocation";
import { prepareBookingNotification } from "./booking-notifications";
import { prepareParticipationWork } from "./reconciliation";
import { preparePersonalCalendarEntries } from "./calendar-entries";
import { remoteOccupiedSql } from "./capacity-accounting";
import { publishedSessionsSql } from "./published-schedule";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import { sessionParticipationResponseSchema } from "../../../../assets/shared/schemas/event-participation-scanning";
import { prepareScopedAuditLogAfterOneChange, isAuditChangeGuardFailure } from "../audit";
export async function reviewSessionParticipation(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  userId: string,
  decision: "approve" | "reject",
  actorId: string,
) {
  const pending = await first<{ id: string }>(
    db,
    "SELECT id FROM agenda_session_participations WHERE event_id=? AND occurrence_id=? AND user_id=? AND status='approval_pending'",
    [eventId, occurrenceId, userId],
  );
  if (!pending) throw new AppError(409, "SESSION_APPROVAL_CONFLICT", "The participation request is no longer pending.");
  const published = await first<{ start_at: string | null; timezone: string }>(
    db,
    `SELECT start_at,timezone FROM (${publishedSessionsSql}) WHERE id=? AND event_id=?`,
    [occurrenceId, eventId],
  );
  if (decision === "approve" && !published)
    throw new AppError(404, "SESSION_NOT_PUBLISHED", "This session is not in the approved agenda.");
  const date = published?.start_at ? instantToDateTimeLocal(published.start_at, published.timezone).slice(0, 10) : null;
  const now = nowIso();
  const statement = db
    .prepare(
      `UPDATE agenda_session_participations AS pending SET allocation_revision=allocation_revision+1,status=CASE WHEN ?='reject' THEN 'canceled'
   WHEN pending.attendance_mode='physical' AND NOT EXISTS(SELECT 1 FROM (${publishedSessionsSql}) s WHERE s.id=pending.occurrence_id AND s.event_id=pending.event_id AND (${physicalAllocationAvailableSql("s", "pending.room_id", "pending.user_id")})) THEN 'waitlisted'
   WHEN pending.attendance_mode='remote' AND (SELECT remote_capacity FROM (${publishedSessionsSql}) WHERE id=pending.occurrence_id) IS NOT NULL AND ${remoteOccupiedSql("pending.occurrence_id", "pending.user_id")}>=(SELECT remote_capacity FROM (${publishedSessionsSql}) WHERE id=pending.occurrence_id) THEN 'waitlisted' ELSE 'reserved' END,approval_state=CASE WHEN ?='reject' THEN 'declined' ELSE 'approved' END,waitlisted_at=COALESCE(waitlisted_at,?),updated_at=?
   WHERE event_id=? AND occurrence_id=? AND user_id=? AND id=? AND status='approval_pending'
   AND (?='reject' OR EXISTS(SELECT 1 FROM (${publishedSessionsSql}) approved WHERE approved.id=pending.occurrence_id AND approved.start_at IS ? AND approved.timezone=? AND (pending.attendance_mode='remote' OR ${physicalRoomEligibleSql("approved", "pending.room_id")})
     AND (approved.booking_opens_at IS NULL OR approved.booking_opens_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND (approved.booking_closes_at IS NULL OR approved.booking_closes_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     AND (approved.access_policy='open' OR EXISTS(SELECT 1 FROM agenda_session_invitations invite WHERE invite.occurrence_id=approved.id AND invite.user_id=pending.user_id AND invite.revoked_at IS NULL))))
   AND (${decision === "reject" ? "1" : "0"}=1 OR ${operationalAllocationCompatibleSql("pending.occurrence_id", "pending.user_id", "pending.attendance_mode", "pending.room_id")})
   AND (?='reject' OR EXISTS(SELECT 1 FROM registrations reg WHERE reg.event_id=pending.event_id AND reg.user_id=pending.user_id AND reg.status='registered' AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=reg.id AND day.day_date=?),CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=pending.event_id AND day.day_date=?) THEN 'none' ELSE reg.attendance_type END)=CASE pending.attendance_mode WHEN 'physical' THEN 'in_person' ELSE 'virtual' END))
   AND (?='reject' OR NOT EXISTS(SELECT 1 FROM agenda_session_participations other JOIN (${publishedSessionsSql}) conflict ON conflict.id=other.occurrence_id JOIN (${publishedSessionsSql}) target ON target.id=pending.occurrence_id WHERE other.user_id=pending.user_id AND other.status='reserved' AND other.occurrence_id<>pending.occurrence_id AND conflict.start_at<target.end_at AND conflict.end_at>target.start_at))`,
    )
    .bind(
      decision,
      decision,
      now,
      now,
      eventId,
      occurrenceId,
      userId,
      pending.id,
      decision,
      published?.start_at ?? null,
      published?.timezone ?? "UTC",
      decision,
      date,
      date,
      decision,
    );
  let result;
  try {
    [result] = await db.batch([
      statement,
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "event", id: eventId },
        "user",
        actorId,
        decision === "approve" ? "session_participation_approved" : "session_participation_rejected",
        "agenda_session_participation",
        pending.id,
        {
          occurrenceId,
          userId,
          decision,
          approvalState: { from: "pending", to: decision === "approve" ? "approved" : "declined" },
        },
        now,
      ),
      ...preparePersonalCalendarEntries(db, eventId, userId),
      prepareParticipationWork(db, eventId),
      prepareBookingNotification(db, eventId, occurrenceId, userId),
    ]);
  } catch (error) {
    if (isAuditChangeGuardFailure(error))
      throw new AppError(
        409,
        "SESSION_APPROVAL_CONFLICT",
        "The request changed, registration is no longer valid, or another reservation overlaps.",
      );
    throw error;
  }
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
