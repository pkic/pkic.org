import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { getActiveFormByPurpose } from "../../../../../_lib/services/forms";
import { all, first } from "../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { parseJsonSafe } from "../../../../../_lib/utils/json";
import { extractDietarySelections } from "../../../../../_lib/utils/registration-dietary";

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
  sponsor_consent: number;
  custom_answers_json: string | null;
}

interface WaitlistSummaryRow {
  registration_id: string;
  summary: string | null;
  count: number;
}

const latestOutboxStatusForRegistrationSql = `(SELECT eo.status
       FROM email_outbox eo
       WHERE eo.recipient_user_id = r.user_id AND eo.event_id = r.event_id
       ORDER BY eo.updated_at DESC
       LIMIT 1)`;

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));

  const url = new URL(c.req.raw.url);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);
  const search = (url.searchParams.get("q") ?? "").trim();
  const statusFilter = url.searchParams.get("status") ?? "";

  const validStatuses = new Set(["registered", "pending_email_confirmation", "cancelled"]);
  const bouncedFilter = url.searchParams.get("bounced") ?? "";
  const consentFilter = url.searchParams.get("consent") ?? "";

  const conditions: string[] = ["r.event_id = ?"];
  const bindings: unknown[] = [event.id];

  if (statusFilter && validStatuses.has(statusFilter)) {
    conditions.push("r.status = ?");
    bindings.push(statusFilter);
  }

  if (bouncedFilter === "true") {
    conditions.push(`${latestOutboxStatusForRegistrationSql} = 'bounced'`);
  } else if (bouncedFilter === "false") {
    conditions.push(`COALESCE(${latestOutboxStatusForRegistrationSql}, '') <> 'bounced'`);
  }

  if (consentFilter === "true") {
    conditions.push(
      "EXISTS(SELECT 1 FROM consent_acceptances ca WHERE ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing')",
    );
  } else if (consentFilter === "false") {
    conditions.push(
      "NOT EXISTS(SELECT 1 FROM consent_acceptances ca WHERE ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing')",
    );
  }

  if (search) {
    conditions.push("(u.email LIKE ? OR COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) LIKE ?)");
    const pattern = `%${search}%`;
    bindings.push(pattern, pattern);
  }

  const whereClause = conditions.join(" AND ");
  const registrationForm = await getActiveFormByPurpose(requestDb(c), event.id, "event_registration");

  const registrationRows = await all<RegistrationRow>(
    requestDb(c),
    `SELECT r.id, r.user_id, r.status, r.attendance_type, r.source_type, r.created_at, r.updated_at,
            u.email AS user_email,
            COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
            rc.code AS referral_code,
            COALESCE(${latestOutboxStatusForRegistrationSql} = 'bounced', 0) AS has_bounced,
            EXISTS(SELECT 1 FROM consent_acceptances ca
                   WHERE ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing') AS sponsor_consent,
                 r.custom_answers_json,
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
  const waitlistSummaries =
    registrationIds.length > 0
      ? await all<WaitlistSummaryRow>(
          requestDb(c),
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

  const waitlistByRegistrationId = new Map(waitlistSummaries.map((row) => [row.registration_id, row]));

  const registrationsWithSummary = rows.map((row) => {
    const summary = waitlistByRegistrationId.get(row.id);
    const dietarySelections = extractDietarySelections(
      parseJsonSafe<Record<string, unknown> | null>(row.custom_answers_json, null),
      registrationForm?.fields,
    );
    return {
      ...row,
      has_bounced: !!row.has_bounced,
      sponsor_consent: !!row.sponsor_consent,
      dietary_restrictions: dietarySelections.length > 0 ? dietarySelections : null,
      dayWaitlistSummary: summary?.summary ?? null,
      dayWaitlistCount: summary?.count ?? 0,
    };
  });

  const [totalRow, statRows, bouncedCountRow, consentCountRow, dietaryRows] = await Promise.all([
    first<{ total: number }>(
      requestDb(c),
      `SELECT COUNT(*) AS total FROM registrations r LEFT JOIN users u ON u.id = r.user_id WHERE ${whereClause}`,
      bindings,
    ),
    // Aggregate stats always cover all registrations for the event (unfiltered)
    all<{ attendance_type: string; status: string; count: number }>(
      requestDb(c),
      `SELECT attendance_type, status, COUNT(*) AS count
       FROM registrations WHERE event_id = ?
       GROUP BY attendance_type, status`,
      [event.id],
    ),
    first<{ bounced_count: number }>(
      requestDb(c),
      `SELECT COUNT(DISTINCT r.id) AS bounced_count
       FROM registrations r
       WHERE r.event_id = ? AND ${latestOutboxStatusForRegistrationSql} = 'bounced'`,
      [event.id],
    ),
    first<{ consent_count: number }>(
      requestDb(c),
      `SELECT COUNT(DISTINCT registration_id) AS consent_count
       FROM consent_acceptances
       WHERE event_id = ? AND term_key = 'sponsor-data-sharing'`,
      [event.id],
    ),
    all<{ custom_answers_json: string | null }>(
      requestDb(c),
      `SELECT r.custom_answers_json
       FROM registrations r
       WHERE r.event_id = ? AND r.status IN ('registered')
         AND r.custom_answers_json IS NOT NULL`,
      [event.id],
    ),
  ]);
  const total = Number(totalRow?.total ?? 0);

  const byAttendanceType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of statRows) {
    // Only include confirmed/registered rows in the attendance-type totals
    if (row.status === "registered") {
      byAttendanceType[row.attendance_type] = (byAttendanceType[row.attendance_type] ?? 0) + Number(row.count);
    }
    // Keep the full per-status totals
    byStatus[row.status] = (byStatus[row.status] ?? 0) + Number(row.count);
  }

  const dietaryCounts: Record<string, number> = {};
  for (const row of dietaryRows) {
    const items = extractDietarySelections(
      parseJsonSafe<Record<string, unknown> | null>(row.custom_answers_json, null),
      registrationForm?.fields,
    );
    for (const item of items) {
      dietaryCounts[item] = (dietaryCounts[item] ?? 0) + 1;
    }
  }

  return json({
    event: { id: event.id, slug: event.slug, name: event.name },
    registrations: registrationsWithSummary,
    stats: {
      byAttendanceType,
      byStatus,
      bouncedCount: Number(bouncedCountRow?.bounced_count ?? 0),
      consentCount: Number(consentCountRow?.consent_count ?? 0),
      dietaryCounts,
    },
    page: {
      limit,
      offset,
      hasMore,
      total,
    },
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }

  return onRequestGet(c);
}
