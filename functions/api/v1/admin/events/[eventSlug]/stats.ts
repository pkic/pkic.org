import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all, first } from "../../../../../_lib/db/queries";

/**
 * GET /api/v1/admin/events/:eventSlug/stats
 *
 * Returns aggregate stats scoped to a single event.
 */
export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);

  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const db = c.env.DB;

  const [
    regStatusRows,
    regAttendanceRows,
    inviteAttendeeRows,
    inviteSpeakerRows,
    proposalStatusRows,
    dailyRegsRows,
    weeklyRegsRows,
  ] = await Promise.all([
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM registrations WHERE event_id = ? GROUP BY status`,
      [event.id],
    ),
    all<{ attendance_type: string; count: number }>(
      db,
      `SELECT attendance_type, COUNT(*) AS count FROM registrations WHERE event_id = ? GROUP BY attendance_type`,
      [event.id],
    ),
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM invites WHERE event_id = ? AND invite_type = 'attendee' GROUP BY status`,
      [event.id],
    ),
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM invites WHERE event_id = ? AND invite_type = 'speaker' GROUP BY status`,
      [event.id],
    ),
    all<{ status: string; count: number }>(
      db,
      `SELECT status, COUNT(*) AS count FROM session_proposals WHERE event_id = ? GROUP BY status`,
      [event.id],
    ),
    all<{ date: string; count: number }>(
      db,
      `SELECT date(created_at) AS date, COUNT(*) AS count
       FROM registrations
       WHERE event_id = ? AND created_at >= date('now', '-30 days')
       GROUP BY date(created_at)
       ORDER BY date ASC`,
      [event.id],
    ),
    all<{ week: string; count: number }>(
      db,
      `SELECT strftime('%Y-W%W', created_at) AS week, COUNT(*) AS count
       FROM registrations
       WHERE event_id = ? AND created_at >= date('now', '-84 days')
       GROUP BY strftime('%Y-%W', created_at)
       ORDER BY week ASC`,
      [event.id],
    ),
  ]);

  const toMap = (rows: Array<{ status: string; count: number }>) =>
    Object.fromEntries(rows.map((r) => [r.status, r.count]));

  const regTotal = regStatusRows.reduce((s, r) => s + r.count, 0);
  const attendeeTotal = inviteAttendeeRows.reduce((s, r) => s + r.count, 0);
  const speakerTotal = inviteSpeakerRows.reduce((s, r) => s + r.count, 0);
  const proposalTotal = proposalStatusRows.reduce((s, r) => s + r.count, 0);

  return json({
    event: { id: event.id, slug: event.slug, name: event.name },
    registrations: {
      byStatus: toMap(regStatusRows),
      byAttendanceType: Object.fromEntries(regAttendanceRows.map((r) => [r.attendance_type, r.count])),
      total: regTotal,
      daily: dailyRegsRows,
      weekly: weeklyRegsRows,
    },
    invites: {
      attendee: { byStatus: toMap(inviteAttendeeRows), total: attendeeTotal },
      speaker: { byStatus: toMap(inviteSpeakerRows), total: speakerTotal },
    },
    proposals: {
      byStatus: toMap(proposalStatusRows),
      total: proposalTotal,
    },
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
