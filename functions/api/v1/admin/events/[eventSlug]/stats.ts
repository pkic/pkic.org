import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all } from "../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

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
export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const db = requestDb(c);

  const [
    regStatusRows,
    regAttendanceRows,
    regStatusAndTypeRows,
    growthByDayRows,
    registrationTotalRow,
    sponsorConsentRow,
    dietaryRows,
    waitlistByDayRows,
    waitlistStatusRows,
    waitlistLaneRows,
    attendanceChangeRows,
    attendanceChangeTotalsRows,
    recentAttendanceChangesRows,
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
    all<{ dietary_restrictions: string | null }>(
      db,
      `SELECT JSON_EXTRACT(custom_answers_json, '$.dietary_restrictions') AS dietary_restrictions
       FROM registrations
       WHERE event_id = ?
         AND status IN ('registered', 'waitlisted')
         AND JSON_EXTRACT(custom_answers_json, '$.dietary_restrictions') IS NOT NULL`,
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
    // Day-level attendance changes (event attendance is measured per day)
    all<{ from_type: string; to_type: string; count: number }>(
      db,
      `SELECT COALESCE(h.from_type, 'not_attending') AS from_type,
              COALESCE(h.to_type, 'not_attending') AS to_type,
              COUNT(*) AS count
       FROM registration_attendance_history h
       JOIN registrations r ON r.id = h.registration_id
       WHERE r.event_id = ?
         AND h.event_day_id IS NOT NULL
         AND COALESCE(h.from_type, '') <> COALESCE(h.to_type, '')
       GROUP BY COALESCE(h.from_type, 'not_attending'), COALESCE(h.to_type, 'not_attending')
       ORDER BY count DESC`,
      [event.id],
    ),
    all<{ total_changes: number; changed_registrations: number }>(
      db,
      `SELECT COUNT(*) AS total_changes,
              COUNT(DISTINCT h.registration_id) AS changed_registrations
       FROM registration_attendance_history h
       JOIN registrations r ON r.id = h.registration_id
       WHERE r.event_id = ?
         AND h.event_day_id IS NOT NULL
         AND COALESCE(h.from_type, '') <> COALESCE(h.to_type, '')`,
      [event.id],
    ),
    all<{
      registration_id: string;
      changed_at: string;
      day_date: string;
      day_label: string | null;
      from_type: string;
      to_type: string;
      user_email: string | null;
      display_name: string | null;
    }>(
      db,
      `SELECT h.registration_id,
              h.changed_at,
              ed.day_date,
              COALESCE(ed.label, ed.day_date) AS day_label,
              COALESCE(h.from_type, 'not_attending') AS from_type,
              COALESCE(h.to_type, 'not_attending') AS to_type,
              u.email AS user_email,
              COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name
       FROM registration_attendance_history h
       JOIN registrations r ON r.id = h.registration_id
       JOIN event_days ed ON ed.id = h.event_day_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ?
         AND h.event_day_id IS NOT NULL
         AND COALESCE(h.from_type, '') <> COALESCE(h.to_type, '')
       ORDER BY h.changed_at DESC
       LIMIT 25`,
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
  const registrationTotal = Number(registrationTotalRow[0]?.count ?? regTotal);
  const sponsorConsentGranted = Number(sponsorConsentRow[0]?.count ?? 0);
  const sponsorConsentNotGranted = Math.max(0, registrationTotal - sponsorConsentGranted);

  const dietaryByOption: Record<string, number> = {};
  let dietaryTotalWithRequirements = 0;
  for (const row of dietaryRows) {
    if (!row.dietary_restrictions) continue;
    try {
      const items = JSON.parse(row.dietary_restrictions) as string[];
      if (!Array.isArray(items) || items.length === 0) continue;
      dietaryTotalWithRequirements += 1;
      for (const item of items) {
        dietaryByOption[item] = (dietaryByOption[item] ?? 0) + 1;
      }
    } catch {
      // Ignore malformed JSON from legacy rows.
    }
  }

  const attendeeTotal = inviteAttendeeRows.reduce((s, r) => s + r.count, 0);
  const speakerTotal = inviteSpeakerRows.reduce((s, r) => s + r.count, 0);
  const proposalTotal = proposalStatusRows.reduce((s, r) => s + r.count, 0);
  const rsvpTotal = rsvpByStatusRows.reduce((s, r) => s + r.count, 0);
  const waitlistTotal = waitlistStatusRows.reduce((s, r) => s + r.count, 0);
  const attendanceChangeTotals = attendanceChangeTotalsRows[0] ?? { total_changes: 0, changed_registrations: 0 };

  return json({
    event: { id: event.id, slug: event.slug, name: event.name },
    registrations: {
      byStatus: toMap(regStatusRows),
      byAttendanceType: Object.fromEntries(regAttendanceRows.map((r) => [r.attendance_type, r.count])),
      byStatusAndType: regStatusAndTypeRows,
      sponsorConsent: { granted: sponsorConsentGranted, notGranted: sponsorConsentNotGranted },
      dietary: { totalWithRequirements: dietaryTotalWithRequirements, byOption: dietaryByOption },
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
      totalChanges: Number(attendanceChangeTotals.total_changes ?? 0),
      changedRegistrations: Number(attendanceChangeTotals.changed_registrations ?? 0),
      byTransition: attendanceChangeRows,
      recent: recentAttendanceChangesRows,
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

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
