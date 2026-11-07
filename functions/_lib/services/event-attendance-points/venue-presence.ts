/**
 * Venue presence from the one attendance model staff badge scans and attendee
 * self check-ins share: physical venue/session observations and eligible lead scans on a captured
 * event day, ignoring voided observations. Online attendance never counts as presence. A check-out is an observation whose scan attempt
 * is a checkout; every other venue observation is a check-in.
 */
import { effectiveAttendanceSql } from "../event-participation/attendance-corrections";

/** Physical observations at sessions and consented lead scans also establish presence. */
const presenceEvidenceSql = `SELECT o.id,o.event_id,o.capture_day_date,o.user_id,o.observed_at,o.attendance_mode,
 COALESCE(attempt.action,'import') AS action,COALESCE(attempt.capture_method,'staff') AS method,o.rowid AS evidence_order
 FROM event_attendance_observations o LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id
 WHERE o.capture_day_date IS NOT NULL AND (o.attendance_mode='physical' OR o.occurrence_id IS NULL) AND ${effectiveAttendanceSql("o")}
 UNION ALL
 SELECT attempt.id,attempt.event_id,attempt.capture_day_date,attempt.user_id,attempt.observed_at,'physical',
 attempt.action,attempt.capture_method,attempt.rowid
 FROM event_scan_attempts attempt WHERE attempt.action='lead' AND attempt.outcome='eligible'
 AND attempt.user_id IS NOT NULL AND attempt.capture_day_date IS NOT NULL`;
const venueObservationsIn = (mode: string) => `FROM (${presenceEvidenceSql}) o WHERE o.attendance_mode=${mode}`;
const venueObservationsSql = venueObservationsIn("'physical'");
const latestEvidenceOrder = "o.observed_at DESC,o.evidence_order DESC,o.id DESC";

/** Every venue observation with its kind (`check_in`/`check_out`), method and recency per person and day. */
export const venueEventsSql = `SELECT o.event_id,o.capture_day_date AS day_date,o.user_id,o.observed_at,
 CASE WHEN o.action='checkout' THEN 'check_out' ELSE 'check_in' END AS direction,
 o.method AS method,
 ROW_NUMBER() OVER(PARTITION BY o.event_id,o.capture_day_date,o.user_id ORDER BY ${latestEvidenceOrder}) AS recency
 ${venueObservationsSql}`;

/**
 * Scalar SQL: `checked_in`, `checked_out` or `none` for one person on one day.
 * Binds event ID, user ID and day date, in that order.
 */
export const venuePresenceSql = `COALESCE((SELECT CASE WHEN o.action='checkout' THEN 'checked_out' ELSE 'checked_in' END
 ${venueObservationsSql} AND o.event_id=? AND o.user_id=? AND o.capture_day_date=?
 ORDER BY ${latestEvidenceOrder} LIMIT 1),'none')`;

/**
 * Scalar SQL: `checked_in`, `checked_out` or `none` for one person on one day
 * in one attendance mode, so someone attending online checks in and out of
 * their own day without ever adding to on-site presence. Binds attendance
 * mode, event ID, user ID and day date, in that order.
 */
export const venuePresenceInModeSql = `COALESCE((SELECT CASE WHEN o.action='checkout' THEN 'checked_out' ELSE 'checked_in' END
 ${venueObservationsIn("?")} AND o.event_id=? AND o.user_id=? AND o.capture_day_date=?
 ORDER BY ${latestEvidenceOrder} LIMIT 1),'none')`;

/** Scalar SQL: when the latest venue observation was made. Same bindings as `venuePresenceSql`. */
export const venuePresenceChangedAtSql = `(SELECT o.observed_at ${venueObservationsSql} AND o.event_id=? AND o.user_id=? AND o.capture_day_date=?
 ORDER BY ${latestEvidenceOrder} LIMIT 1)`;

/** Scalar SQL: whether a person has an effective check-in at a session. Binds event, user and session IDs. */
export const sessionCheckedInSql = `EXISTS(SELECT 1 FROM event_attendance_observations o LEFT JOIN event_scan_attempts attempt ON attempt.id=o.attempt_id
 WHERE o.event_id=? AND o.user_id=? AND o.occurrence_id=? AND COALESCE(attempt.action,'import')<>'checkout' AND ${effectiveAttendanceSql("o")})`;
