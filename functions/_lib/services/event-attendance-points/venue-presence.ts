/**
 * Venue presence from the one attendance model staff badge scans and attendee
 * self check-ins share: event-wide physical observations on a captured event
 * day, ignoring voided ones. Online attendance never counts as presence. A check-out is an observation whose scan attempt
 * is a checkout; every other venue observation is a check-in.
 */
import { effectiveAttendanceSql } from "../event-participation/attendance-corrections";

const venueObservationsIn = (
  mode: string,
) => `FROM event_attendance_observations o LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id
 WHERE o.occurrence_id IS NULL AND o.attendance_mode=${mode} AND o.capture_day_date IS NOT NULL AND ${effectiveAttendanceSql("o")}`;
const venueObservationsSql = venueObservationsIn("'physical'");

/** Every venue observation with its kind (`check_in`/`check_out`), method and recency per person and day. */
export const venueEventsSql = `SELECT o.event_id,o.capture_day_date AS day_date,o.user_id,o.observed_at,
 CASE WHEN COALESCE(attempt.action,'import')='checkout' THEN 'check_out' ELSE 'check_in' END AS direction,
 COALESCE(attempt.capture_method,'staff') AS method,
 ROW_NUMBER() OVER(PARTITION BY o.event_id,o.capture_day_date,o.user_id ORDER BY o.observed_at DESC,o.rowid DESC) AS recency
 ${venueObservationsSql}`;

/**
 * Scalar SQL: `checked_in`, `checked_out` or `none` for one person on one day.
 * Binds event ID, user ID and day date, in that order.
 */
export const venuePresenceSql = `COALESCE((SELECT CASE WHEN COALESCE(attempt.action,'import')='checkout' THEN 'checked_out' ELSE 'checked_in' END
 ${venueObservationsSql} AND o.event_id=? AND o.user_id=? AND o.capture_day_date=?
 ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 1),'none')`;

/**
 * Scalar SQL: `checked_in`, `checked_out` or `none` for one person on one day
 * in one attendance mode, so someone attending online checks in and out of
 * their own day without ever adding to on-site presence. Binds attendance
 * mode, event ID, user ID and day date, in that order.
 */
export const venuePresenceInModeSql = `COALESCE((SELECT CASE WHEN COALESCE(attempt.action,'import')='checkout' THEN 'checked_out' ELSE 'checked_in' END
 ${venueObservationsIn("?")} AND o.event_id=? AND o.user_id=? AND o.capture_day_date=?
 ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 1),'none')`;

/** Scalar SQL: when the latest venue observation was made. Same bindings as `venuePresenceSql`. */
export const venuePresenceChangedAtSql = `(SELECT o.observed_at ${venueObservationsSql} AND o.event_id=? AND o.user_id=? AND o.capture_day_date=?
 ORDER BY o.observed_at DESC,o.rowid DESC LIMIT 1)`;

/** Scalar SQL: whether a person has an effective check-in at a session. Binds event, user and session IDs. */
export const sessionCheckedInSql = `EXISTS(SELECT 1 FROM event_attendance_observations o LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id
 WHERE o.event_id=? AND o.user_id=? AND o.occurrence_id=? AND COALESCE(attempt.action,'import')<>'checkout' AND ${effectiveAttendanceSql("o")})`;
