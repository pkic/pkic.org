/** Trusted SQL expressions only; entry checks never allocate capacity. */
export function sessionAccessEligibleSql(
  session: string,
  user: string,
  mode: string | null,
  requireReservation = true,
) {
  // A reservation holds a seat in the session's room pool, valid in any of its rooms.
  const placement = mode ? ` AND entry.attendance_mode=${mode}` : "";
  const reserved = `EXISTS(SELECT 1 FROM agenda_session_participations entry WHERE entry.event_id=${session}.event_id AND entry.occurrence_id=${session}.id AND entry.user_id=${user} AND entry.status='reserved'${placement})`;
  const invited = `EXISTS(SELECT 1 FROM agenda_session_invitations invite WHERE invite.event_id=${session}.event_id AND invite.occurrence_id=${session}.id AND invite.user_id=${user} AND invite.revoked_at IS NULL)`;
  return `${requireReservation ? `(${session}.admission_policy IN ('preference','optional_reservation') OR ${reserved}) AND ` : ""}(${session}.visibility='public' OR ${reserved} OR ${invited}) AND (${session}.access_policy='open' OR ${invited})`;
}

/** Configured days override the event-wide attendance summary, including missing day choices. */
export function registrationDayAttendanceSql(registration: string, dayDate: string) {
  return `COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=${registration}.id AND day.event_id=${registration}.event_id AND day.day_date=${dayDate}),CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=${registration}.event_id AND day.day_date=${dayDate}) THEN 'none' ELSE ${registration}.attendance_type END)`;
}
