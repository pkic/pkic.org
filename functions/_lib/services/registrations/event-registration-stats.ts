import type { DatabaseLike } from "../../types";
import { all } from "../../db/queries";

/** Distinct registration/type pairs from day selections, with the temporary no-day fallback. */
export const eventRegistrationAttendanceTypesSql = `
  SELECT DISTINCT r.id, r.status, r.created_at, day.attendance_type
    FROM registrations r JOIN registration_day_attendance day ON day.registration_id = r.id
   WHERE r.event_id = ?
  UNION ALL
  SELECT r.id, r.status, r.created_at, r.attendance_type FROM registrations r
   WHERE r.event_id = ?
     AND NOT EXISTS (SELECT 1 FROM registration_day_attendance day WHERE day.registration_id = r.id)`;

interface EventRegistrationStatsRow {
  kind: "status" | "type";
  value: string;
  count: number;
}

/** Count each registration once per selected attendance type and once per status. */
export async function getEventRegistrationStats(
  db: DatabaseLike,
  eventId: string,
): Promise<{
  byAttendanceType: Record<string, number>;
  byStatus: Record<string, number>;
}> {
  const rows = await all<EventRegistrationStatsRow>(
    db,
    `
    WITH registration_types AS (${eventRegistrationAttendanceTypesSql})
    SELECT 'status' AS kind, status AS value, COUNT(*) AS count
      FROM registrations WHERE event_id = ? GROUP BY status
    UNION ALL
    SELECT 'type' AS kind, attendance_type AS value, COUNT(*) AS count FROM registration_types
      WHERE status = 'registered' GROUP BY attendance_type`,
    [eventId, eventId, eventId],
  );
  const byAttendanceType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of rows) (row.kind === "type" ? byAttendanceType : byStatus)[row.value] = Number(row.count);
  return { byAttendanceType, byStatus };
}
