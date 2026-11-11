import type { DatabaseLike } from "../../types";
import { all } from "../../db/queries";
import { activeDayWaitlistExistsSql } from "./day-states";

/** Distinct registration/type pairs from day selections. */
export const registrationAttendanceTypesSql = `
  SELECT DISTINCT r.id, r.status, r.created_at, day.attendance_type
    FROM registrations r JOIN registration_day_attendance day ON day.registration_id = r.id`;

export const eventRegistrationAttendanceTypesSql = `${registrationAttendanceTypesSql} WHERE r.event_id = ?`;

interface EventRegistrationStatsRow {
  kind: "status" | "type" | "waitlist";
  value: string;
  count: number;
}

/**
 * Count each registration once per selected attendance type and once per
 * status, and count the live registrations waiting for a seat on any day.
 */
export async function getEventRegistrationStats(
  db: DatabaseLike,
  eventId: string,
): Promise<{
  byAttendanceType: Record<string, number>;
  byStatus: Record<string, number>;
  waitlistedCount: number;
}> {
  const rows = await all<EventRegistrationStatsRow>(
    db,
    `
    WITH registration_types AS (${eventRegistrationAttendanceTypesSql})
    SELECT 'status' AS kind, status AS value, COUNT(*) AS count
      FROM registrations WHERE event_id = ? GROUP BY status
    UNION ALL
    SELECT 'type' AS kind, attendance_type AS value, COUNT(*) AS count FROM registration_types
      WHERE status = 'registered' GROUP BY attendance_type
    UNION ALL
    SELECT 'waitlist' AS kind, 'waitlisted' AS value, COUNT(*) AS count FROM registrations r
      WHERE r.event_id = ? AND r.status <> 'cancelled' AND ${activeDayWaitlistExistsSql("r")}`,
    [eventId, eventId, eventId],
  );
  const byAttendanceType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let waitlistedCount = 0;
  for (const row of rows) {
    if (row.kind === "waitlist") waitlistedCount = Number(row.count);
    else (row.kind === "type" ? byAttendanceType : byStatus)[row.value] = Number(row.count);
  }
  return { byAttendanceType, byStatus, waitlistedCount };
}
