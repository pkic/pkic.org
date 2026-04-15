import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all, first } from "../../../../../_lib/db/queries";

interface RegistrationRow {
  id: string;
  user_id: string;
  status: string;
  attendance_type: string | null;
  source_type: string | null;
  created_at: string;
  updated_at: string;
  user_email: string | null;
  display_name: string | null;
  referral_code: string | null;
  rsvp_events_json: string | null;
  has_bounced: number;
}

interface WaitlistSummaryRow {
  registration_id: string;
  summary: string | null;
  count: number;
}

export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));

  const url = new URL(c.req.raw.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const search = (url.searchParams.get("q") ?? "").trim();
  const statusFilter = url.searchParams.get("status") ?? "";

  const validStatuses = new Set(["registered", "pending_email_confirmation", "waitlisted", "cancelled"]);
  const bouncedFilter = url.searchParams.get("bounced") ?? "";

  const conditions: string[] = ["r.event_id = ?"];
  const bindings: unknown[] = [event.id];

  if (statusFilter && validStatuses.has(statusFilter)) {
    conditions.push("r.status = ?");
    bindings.push(statusFilter);
  }

  if (bouncedFilter === "true") {
    conditions.push(`EXISTS (
      SELECT 1 FROM email_outbox eo
      WHERE eo.recipient_user_id = r.user_id AND eo.event_id = r.event_id AND eo.status = 'bounced'
    )`);
  } else if (bouncedFilter === "false") {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM email_outbox eo
      WHERE eo.recipient_user_id = r.user_id AND eo.event_id = r.event_id AND eo.status = 'bounced'
    )`);
  }

  if (search) {
    conditions.push("(u.email LIKE ? OR COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) LIKE ?)");
    const pattern = `%${search}%`;
    bindings.push(pattern, pattern);
  }

  const whereClause = conditions.join(" AND ");

  const registrationRows = await all<RegistrationRow>(
    c.env.DB,
    `SELECT r.id, r.user_id, r.status, r.attendance_type, r.source_type, r.created_at, r.updated_at,
            u.email AS user_email,
            COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
            rc.code AS referral_code,
            EXISTS (
              SELECT 1 FROM email_outbox eo
              WHERE eo.recipient_user_id = r.user_id AND eo.event_id = r.event_id AND eo.status = 'bounced'
            ) AS has_bounced,
            (SELECT JSON_GROUP_ARRAY(JSON_OBJECT(
                'uid', ics_uid,
                'status', response_status,
                'warning_sent_at', warning_sent_at,
                'action_executed_at', action_executed_at,
                'action_taken', action_taken,
                'raw_payload_json', raw_payload_json
            )) 
             FROM (
               SELECT ics_uid, response_status, warning_sent_at, action_executed_at, action_taken, raw_payload_json,
                      ROW_NUMBER() OVER (PARTITION BY ics_uid ORDER BY created_at DESC) AS rn
               FROM calendar_rsvp_events
               WHERE registration_id = r.id
             )
             WHERE rn = 1
            ) AS rsvp_events_json
     FROM registrations r
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN referral_codes rc ON rc.owner_type = 'registration' AND rc.owner_id = r.id
     WHERE ${whereClause}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [...bindings, limit + 1, offset],
  );

  const hasMore = registrationRows.length > limit;
  const rows = hasMore ? registrationRows.slice(0, limit) : registrationRows;

  const registrationIds = rows.map((row) => row.id);
  const waitlistSummaries = registrationIds.length > 0
    ? await all<WaitlistSummaryRow>(
      c.env.DB,
      `SELECT
         w.registration_id,
         GROUP_CONCAT(CASE
           WHEN ed.label IS NOT NULL AND ed.label <> '' THEN ed.label || ' (' || w.status || ')'
           ELSE ed.day_date || ' (' || w.status || ')'
         END, ' · ') AS summary,
         COUNT(*) AS count
       FROM event_day_waitlist_entries w
       LEFT JOIN event_days ed ON ed.id = w.event_day_id
       WHERE w.registration_id IN (${registrationIds.map(() => "?").join(",")})
         AND w.status IN ('waiting', 'offered')
       GROUP BY w.registration_id`,
      registrationIds,
    )
    : [];

  const waitlistByRegistrationId = new Map(
    waitlistSummaries.map((row) => [row.registration_id, row]),
  );

  const registrationsWithSummary = rows.map((row) => {
    const summary = waitlistByRegistrationId.get(row.id);
    return {
      ...row,
      has_bounced: !!row.has_bounced,
      dayWaitlistSummary: summary?.summary ?? null,
      dayWaitlistCount: summary?.count ?? 0,
    };
  });

  const [totalRow, statRows, bouncedCountRow] = await Promise.all([
    first<{ total: number }>(
      c.env.DB,
      `SELECT COUNT(*) AS total FROM registrations r LEFT JOIN users u ON u.id = r.user_id WHERE ${whereClause}`,
      bindings,
    ),
    // Aggregate stats always cover all registrations for the event (unfiltered)
    all<{ attendance_type: string; status: string; count: number }>(
      c.env.DB,
      `SELECT attendance_type, status, COUNT(*) AS count
       FROM registrations WHERE event_id = ?
       GROUP BY attendance_type, status`,
      [event.id],
    ),
    first<{ bounced_count: number }>(
      c.env.DB,
      `SELECT COUNT(DISTINCT r.id) AS bounced_count
       FROM registrations r
       JOIN email_outbox eo ON eo.recipient_user_id = r.user_id AND eo.event_id = r.event_id AND eo.status = 'bounced'
       WHERE r.event_id = ?`,
      [event.id],
    ),
  ]);
  const total = Number(totalRow?.total ?? 0);

  const byAttendanceType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of statRows) {
    byAttendanceType[row.attendance_type] = (byAttendanceType[row.attendance_type] ?? 0) + Number(row.count);
    byStatus[row.status] = (byStatus[row.status] ?? 0) + Number(row.count);
  }

  return json({
    event: { id: event.id, slug: event.slug, name: event.name },
    registrations: registrationsWithSummary,
    stats: { byAttendanceType, byStatus, bouncedCount: Number(bouncedCountRow?.bounced_count ?? 0) },
    page: {
      limit,
      offset,
      hasMore,
      total,
    },
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestGet(c);
}
