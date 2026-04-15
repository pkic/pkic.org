import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all } from "../../../../../_lib/db/queries";

/**
 * GET /api/v1/admin/events/:eventSlug/stats
 *
 * Returns detailed stats scoped to a single event, including:
 * - Registration breakdown by status and attendance type (cross-tab)
 * - Full registration growth history by calendar day and type
 * - Per-event-day attendance breakdown (confirmed registrations)
 * - Invite funnel with decline reason breakdown
 * - Proposal status breakdown
 */
export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);

  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const db = c.env.DB;

  const [
    regStatusRows,
    regAttendanceRows,
    regStatusAndTypeRows,
    growthByDayRows,
    dayAttendanceRows,
    inviteAttendeeRows,
    inviteSpeakerRows,
    attendeeDeclineRows,
    speakerDeclineRows,
    proposalStatusRows,
    rsvpByStatusRows,
    rsvpByProviderRows,
    rsvpActionsTakenRows,
  ] = await Promise.all([
    // Registration counts by status
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM registrations WHERE event_id = ? GROUP BY status`,
      [event.id],
    ),
    // Registration counts by attendance type
    all<{ attendance_type: string; count: number }>(
      db,
      `SELECT attendance_type, COUNT(*) AS count FROM registrations WHERE event_id = ? GROUP BY attendance_type`,
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
    // Per-event-day attendance (all non-cancelled statuses, split by status)
    all<{
      day_date: string;
      label: string | null;
      sort_order: number;
      attendance_type: string;
      status: string;
      count: number;
    }>(
      db,
      `SELECT ed.day_date,
              COALESCE(ed.label, ed.day_date) AS label,
              ed.sort_order,
              rda.attendance_type,
              r.status,
              COUNT(r.id) AS count
       FROM event_days ed
       JOIN registration_day_attendance rda ON rda.event_day_id = ed.id
       JOIN registrations r ON r.id = rda.registration_id AND r.status != 'cancelled'
       WHERE ed.event_id = ?
       GROUP BY ed.id, rda.attendance_type, r.status
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
  ]);

  const toMap = (rows: Array<{ status: string; count: number }>) =>
    Object.fromEntries(rows.map((r) => [r.status, r.count]));

  const regTotal = regStatusRows.reduce((s, r) => s + r.count, 0);
  const attendeeTotal = inviteAttendeeRows.reduce((s, r) => s + r.count, 0);
  const speakerTotal = inviteSpeakerRows.reduce((s, r) => s + r.count, 0);
  const proposalTotal = proposalStatusRows.reduce((s, r) => s + r.count, 0);
  const rsvpTotal = rsvpByStatusRows.reduce((s, r) => s + r.count, 0);

  return json({
    event: { id: event.id, slug: event.slug, name: event.name },
    registrations: {
      byStatus: toMap(regStatusRows),
      byAttendanceType: Object.fromEntries(regAttendanceRows.map((r) => [r.attendance_type, r.count])),
      byStatusAndType: regStatusAndTypeRows,
      total: regTotal,
      growthByDay: growthByDayRows,
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

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
