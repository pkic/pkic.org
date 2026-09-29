import type { DatabaseLike, StatementLike } from "../../types";
import {
  prepareAttendanceChangeStatisticsStatements,
  prepareAttendanceStatusByTypeStatement,
} from "../registrations/attendance-statistics";

/**
 * Prepare the complete event analytics projection as one bounded D1 batch.
 * Keep this order aligned with the named result decoding in analytics.ts.
 */
export function prepareEventAnalyticsStatements(
  db: DatabaseLike,
  eventId: string,
  includeProposalStats: boolean,
): StatementLike[] {
  const proposalStatement = includeProposalStats
    ? db
        .prepare(`SELECT status, COUNT(*) AS count FROM session_proposals WHERE event_id = ? GROUP BY status`)
        .bind(eventId)
    : db.prepare(`SELECT NULL AS status, 0 AS count WHERE 0`);

  return [
    db.prepare(`SELECT status, COUNT(*) AS count FROM registrations WHERE event_id = ? GROUP BY status`).bind(eventId),
    db
      .prepare(
        `SELECT attendance_type, COUNT(*) AS count
         FROM registrations
         WHERE event_id = ? AND status = 'registered'
         GROUP BY attendance_type`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT status, attendance_type, COUNT(*) AS count
         FROM registrations
         WHERE event_id = ?
         GROUP BY status, attendance_type`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT date(created_at) AS date, attendance_type, COUNT(*) AS count
         FROM registrations
         WHERE event_id = ?
         GROUP BY date(created_at), attendance_type
         ORDER BY date ASC`,
      )
      .bind(eventId),
    db.prepare(`SELECT COUNT(*) AS count FROM registrations WHERE event_id = ?`).bind(eventId),
    db
      .prepare(
        `SELECT COUNT(DISTINCT registration_id) AS count
         FROM consent_acceptances
         WHERE event_id = ? AND term_key = 'sponsor-data-sharing'`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT ed.day_date,
                COALESCE(ed.label, ed.day_date) AS label,
                ed.sort_order,
                w.status,
                w.priority_lane,
                COUNT(w.id) AS count
         FROM event_days ed
         JOIN event_day_waitlist_entries w ON w.event_day_id = ed.id
         WHERE ed.event_id = ?
         GROUP BY ed.id, w.status, w.priority_lane
         ORDER BY ed.sort_order ASC, ed.day_date ASC`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM event_day_waitlist_entries
         WHERE event_id = ?
         GROUP BY status`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT priority_lane, COUNT(*) AS count
         FROM event_day_waitlist_entries
         WHERE event_id = ?
         GROUP BY priority_lane`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT ed.day_date,
                COALESCE(ed.label, ed.day_date) AS label,
                ed.sort_order,
                rda.attendance_type,
                CASE
                  WHEN w.id IS NOT NULL THEN 'waitlisted'
                  WHEN r.status = 'registered' THEN 'accepted'
                  ELSE 'pending'
                END AS attendance_status,
                COUNT(DISTINCT r.id) AS count
         FROM event_days ed
         JOIN registration_day_attendance rda ON rda.event_day_id = ed.id
         JOIN registrations r ON r.id = rda.registration_id AND r.status != 'cancelled'
         LEFT JOIN event_day_waitlist_entries w
           ON w.event_day_id = ed.id
          AND w.registration_id = r.id
          AND w.status IN ('waiting', 'offered')
         WHERE ed.event_id = ?
         GROUP BY ed.id, rda.attendance_type, attendance_status
         ORDER BY ed.sort_order ASC, ed.day_date ASC`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM invites
         WHERE event_id = ? AND invite_type = 'attendee'
         GROUP BY status`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM invites
         WHERE event_id = ? AND invite_type = 'speaker'
         GROUP BY status`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT decline_reason_code AS reason_code,
                COUNT(*) AS count,
                SUM(CAST(unsubscribe_future AS INTEGER)) AS unsubscribed
         FROM invites
         WHERE event_id = ? AND invite_type = 'attendee' AND status = 'declined'
         GROUP BY decline_reason_code
         ORDER BY count DESC`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT decline_reason_code AS reason_code,
                COUNT(*) AS count,
                SUM(CAST(unsubscribe_future AS INTEGER)) AS unsubscribed
         FROM invites
         WHERE event_id = ? AND invite_type = 'speaker' AND status = 'declined'
         GROUP BY decline_reason_code
         ORDER BY count DESC`,
      )
      .bind(eventId),
    proposalStatement,
    db
      .prepare(
        `SELECT cre.response_status, COUNT(*) AS count
         FROM calendar_rsvp_events cre
         JOIN registrations r ON r.id = cre.registration_id
         WHERE r.event_id = ?
         GROUP BY cre.response_status
         ORDER BY count DESC`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT cre.provider, COUNT(*) AS count
         FROM calendar_rsvp_events cre
         JOIN registrations r ON r.id = cre.registration_id
         WHERE r.event_id = ?
         GROUP BY cre.provider
         ORDER BY count DESC`,
      )
      .bind(eventId),
    db
      .prepare(
        `SELECT cre.action_taken, COUNT(*) AS count
         FROM calendar_rsvp_events cre
         JOIN registrations r ON r.id = cre.registration_id
         WHERE r.event_id = ? AND cre.action_taken IS NOT NULL
         GROUP BY cre.action_taken
         ORDER BY count DESC`,
      )
      .bind(eventId),
    ...prepareAttendanceChangeStatisticsStatements(db, eventId),
    prepareAttendanceStatusByTypeStatement(db, eventId),
  ];
}
