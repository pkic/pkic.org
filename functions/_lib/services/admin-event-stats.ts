import type { AdminEventStatsResponse } from "../../../assets/shared/schemas/admin-analytics";
import { adminEventStatsResponseSchema } from "../../../assets/shared/schemas/admin-analytics";
import { all } from "../db/queries";
import type { DatabaseLike } from "../types";
import type { EventRecord } from "./event-types";
import { getAttendanceChangeStatistics, getAttendanceStatusByType } from "./registrations/admin-statistics";

/**
 * Builds the event dashboard read model. Querying and aggregation stay in
 * this service so the HTTP route is only authentication and transport.
 */
export async function getAdminEventStats(
  db: DatabaseLike,
  event: Pick<EventRecord, "id" | "slug" | "name">,
): Promise<AdminEventStatsResponse> {
  const [
    regStatusRows,
    regAttendanceRows,
    regStatusAndTypeRows,
    growthByDayRows,
    registrationTotalRow,
    sponsorConsentRow,
    waitlistByDayRows,
    waitlistStatusRows,
    waitlistLaneRows,
    attendanceChanges,
    dayAttendanceRows,
    inviteAttendeeRows,
    inviteSpeakerRows,
    attendeeDeclineRows,
    speakerDeclineRows,
    proposalStatusRows,
    rsvpByStatusRows,
    rsvpByProviderRows,
    rsvpActionsTakenRows,
    attendanceStatusByType,
  ] = await Promise.all([
    // Registration counts by status
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM registrations WHERE event_id = ? GROUP BY status`,
      [event.id],
    ),
    // Registration counts by attendance type (only confirmed/registered)
    all<{ attendance_type: string; count: number }>(
      db,
      `SELECT attendance_type, COUNT(*) AS count FROM registrations WHERE event_id = ? AND status = 'registered' GROUP BY attendance_type`,
      [event.id],
    ),
    // Cross-tab: status × attendance type
    all<{ status: string; attendance_type: string; count: number }>(
      db,
      `SELECT status, attendance_type, COUNT(*) AS count
       FROM registrations WHERE event_id = ?
       GROUP BY status, attendance_type`,
      [event.id],
    ),
    // Full registration growth history by calendar day + attendance type
    all<{ date: string; attendance_type: string; count: number }>(
      db,
      `SELECT date(created_at) AS date, attendance_type, COUNT(*) AS count
       FROM registrations
       WHERE event_id = ?
       GROUP BY date(created_at), attendance_type
       ORDER BY date ASC`,
      [event.id],
    ),
    all<{ count: number }>(db, `SELECT COUNT(*) AS count FROM registrations WHERE event_id = ?`, [event.id]),
    all<{ count: number }>(
      db,
      `SELECT COUNT(DISTINCT registration_id) AS count
       FROM consent_acceptances
       WHERE event_id = ? AND term_key = 'sponsor-data-sharing'`,
      [event.id],
    ),
    // Per-day waitlist breakdown by status and priority lane
    all<{
      day_date: string;
      label: string | null;
      sort_order: number;
      status: string;
      priority_lane: string;
      count: number;
    }>(
      db,
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
      [event.id],
    ),
    // Waitlist totals by status
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count
       FROM event_day_waitlist_entries
       WHERE event_id = ?
       GROUP BY status`,
      [event.id],
    ),
    // Waitlist totals by lane
    all<{ priority_lane: string; count: number }>(
      db,
      `SELECT priority_lane, COUNT(*) AS count
       FROM event_day_waitlist_entries
       WHERE event_id = ?
       GROUP BY priority_lane`,
      [event.id],
    ),
    getAttendanceChangeStatistics(db, event.id),
    // Per-event-day attendance split by accepted, waitlisted and pending state
    all<{
      day_date: string;
      label: string | null;
      sort_order: number;
      attendance_type: string;
      attendance_status: string;
      count: number;
    }>(
      db,
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
      [event.id],
    ),
    // Attendee invite counts by status
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM invites WHERE event_id = ? AND invite_type = 'attendee' GROUP BY status`,
      [event.id],
    ),
    // Speaker invite counts by status
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM invites WHERE event_id = ? AND invite_type = 'speaker' GROUP BY status`,
      [event.id],
    ),
    // Attendee invite decline reasons
    all<{ reason_code: string | null; count: number; unsubscribed: number }>(
      db,
      `SELECT decline_reason_code AS reason_code,
              COUNT(*) AS count,
              SUM(CAST(unsubscribe_future AS INTEGER)) AS unsubscribed
       FROM invites
       WHERE event_id = ? AND invite_type = 'attendee' AND status = 'declined'
       GROUP BY decline_reason_code
       ORDER BY count DESC`,
      [event.id],
    ),
    // Speaker invite decline reasons
    all<{ reason_code: string | null; count: number; unsubscribed: number }>(
      db,
      `SELECT decline_reason_code AS reason_code,
              COUNT(*) AS count,
              SUM(CAST(unsubscribe_future AS INTEGER)) AS unsubscribed
       FROM invites
       WHERE event_id = ? AND invite_type = 'speaker' AND status = 'declined'
       GROUP BY decline_reason_code
       ORDER BY count DESC`,
      [event.id],
    ),
    // Proposal counts by status
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM session_proposals WHERE event_id = ? GROUP BY status`,
      [event.id],
    ),
    // RSVP (calendar reply) counts by response status
    all<{ response_status: string; count: number }>(
      db,
      `SELECT cre.response_status, COUNT(*) AS count
       FROM calendar_rsvp_events cre
       JOIN registrations r ON r.id = cre.registration_id
       WHERE r.event_id = ?
       GROUP BY cre.response_status
       ORDER BY count DESC`,
      [event.id],
    ),
    // RSVP counts by calendar provider
    all<{ provider: string; count: number }>(
      db,
      `SELECT cre.provider, COUNT(*) AS count
       FROM calendar_rsvp_events cre
       JOIN registrations r ON r.id = cre.registration_id
       WHERE r.event_id = ?
       GROUP BY cre.provider
       ORDER BY count DESC`,
      [event.id],
    ),
    // RSVP pipeline actions taken (non-null only)
    all<{ action_taken: string; count: number }>(
      db,
      `SELECT cre.action_taken, COUNT(*) AS count
       FROM calendar_rsvp_events cre
       JOIN registrations r ON r.id = cre.registration_id
       WHERE r.event_id = ? AND cre.action_taken IS NOT NULL
       GROUP BY cre.action_taken
       ORDER BY count DESC`,
      [event.id],
    ),
    getAttendanceStatusByType(db, event.id),
  ]);

  const toMap = (rows: Array<{ status: string; count: number }>) =>
    Object.fromEntries(rows.map((r) => [r.status, r.count]));

  const regTotal = regStatusRows.reduce((s, r) => s + r.count, 0);
  const registrationTotal = Number(registrationTotalRow[0]?.count ?? regTotal);
  const sponsorConsentGranted = Number(sponsorConsentRow[0]?.count ?? 0);
  const sponsorConsentNotGranted = Math.max(0, registrationTotal - sponsorConsentGranted);

  const attendeeTotal = inviteAttendeeRows.reduce((s, r) => s + r.count, 0);
  const speakerTotal = inviteSpeakerRows.reduce((s, r) => s + r.count, 0);
  const proposalTotal = proposalStatusRows.reduce((s, r) => s + r.count, 0);
  const rsvpTotal = rsvpByStatusRows.reduce((s, r) => s + r.count, 0);
  const waitlistTotal = waitlistStatusRows.reduce((s, r) => s + r.count, 0);

  return adminEventStatsResponseSchema.parse({
    event: { id: event.id, slug: event.slug, name: event.name },
    registrations: {
      byStatus: toMap(regStatusRows),
      byAttendanceType: Object.fromEntries(regAttendanceRows.map((r) => [r.attendance_type, r.count])),
      attendanceStatusByType,
      byStatusAndType: regStatusAndTypeRows,
      sponsorConsent: { granted: sponsorConsentGranted, notGranted: sponsorConsentNotGranted },
      total: regTotal,
      growthByDay: growthByDayRows,
    },
    waitlistByEventDay: waitlistByDayRows,
    waitlistTotals: {
      total: waitlistTotal,
      byStatus: toMap(waitlistStatusRows),
      byPriorityLane: Object.fromEntries(waitlistLaneRows.map((r) => [r.priority_lane, r.count])),
    },
    attendanceChanges: {
      ...attendanceChanges,
      totalChanges: attendanceChanges.dayChanges,
      changedRegistrations: attendanceChanges.changedAttendees,
    },
    registrationsByEventDay: dayAttendanceRows,
    invites: {
      attendee: {
        byStatus: toMap(inviteAttendeeRows),
        total: attendeeTotal,
        declineReasons: attendeeDeclineRows,
      },
      speaker: {
        byStatus: toMap(inviteSpeakerRows),
        total: speakerTotal,
        declineReasons: speakerDeclineRows,
      },
    },
    proposals: {
      byStatus: toMap(proposalStatusRows),
      total: proposalTotal,
    },
    rsvp: {
      byStatus: Object.fromEntries(rsvpByStatusRows.map((r) => [r.response_status, r.count])),
      byProvider: Object.fromEntries(rsvpByProviderRows.map((r) => [r.provider, r.count])),
      actionsTaken: Object.fromEntries(rsvpActionsTakenRows.map((r) => [r.action_taken, r.count])),
      total: rsvpTotal,
    },
  });
}
