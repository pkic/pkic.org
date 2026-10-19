/**
 * The attendee's registered standing on one event day, read from the same
 * registration, day attendance and day waiting-list records registration uses.
 * Standing never refuses a check-in; it is recorded with it, and decides only
 * whether the check-in counts as attending online.
 */
import type { AttendanceStandingForDay } from "../../../../assets/shared/attendance-points";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { registrationDayAttendanceSql } from "../event-participation/session-access";
import { NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL } from "../registrations/day-waitlist-policy";

const waitlistedSql = `EXISTS(SELECT 1 FROM event_day_waitlist_entries w JOIN event_days waiting_day ON waiting_day.id=w.event_day_id
 WHERE w.registration_id=reg.id AND waiting_day.event_id=reg.event_id AND waiting_day.day_date=target.day_date AND ${NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL})`;

const registrationSql = `FROM (SELECT ? AS day_date) target JOIN registrations reg ON reg.event_id=? AND reg.user_id=?
 JOIN users person ON person.id=reg.user_id AND person.active=1`;

export async function readDayStanding(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  dayDate: string,
): Promise<AttendanceStandingForDay | null> {
  const row = await first<{ status: string; day_attendance: string; waitlisted: number }>(
    db,
    `SELECT reg.status,${registrationDayAttendanceSql("reg", "target.day_date")} AS day_attendance,${waitlistedSql} AS waitlisted
     ${registrationSql} ORDER BY reg.created_at DESC LIMIT 1`,
    [dayDate, eventId, userId],
  );
  if (!row) return null;
  const attendance = row.day_attendance;
  return {
    registered: row.status === "registered",
    dayAttendance:
      attendance === "in_person" || attendance === "virtual" || attendance === "on_demand" ? attendance : "none",
    waitlisted: Boolean(row.waitlisted),
  };
}

/**
 * Scalar SQL for the atomic write: 1 while the same registration
 * `readDayStanding` reads attends the day online, else 0. The write compares
 * it with the standing it was evaluated with, so a check-in is recorded in the
 * mode its standing was read in.
 */
export function remoteStandingSql(eventId: string, userId: string, dayDate: string) {
  return {
    sql: `COALESCE((SELECT reg.status='registered' AND ${registrationDayAttendanceSql("reg", "target.day_date")} IN ('virtual','on_demand')
 ${registrationSql} ORDER BY reg.created_at DESC LIMIT 1),0)`,
    bindings: [dayDate, eventId, userId],
  };
}
