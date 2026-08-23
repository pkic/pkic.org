/**
 * Bounded, set-based read model for the admin event registrations list
 * (GET /api/v1/admin/events/:eventSlug/registrations) — split out of the
 * route so the SQL/filter construction isn't inlined in HTTP-handling code
 * (PR #1 review, Phase 6).
 */
import { all, first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveOrderBy } from "../../db/sort";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { getAttendanceStatusByType, type AttendanceStatusCount } from "./admin-statistics";
import {
  EVENT_REGISTRATIONS_SORT_COLUMNS,
  type AdminEventRegistrationsQuery,
} from "../../../../assets/shared/schemas/admin-events";
import type { DatabaseLike } from "../../types";

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

interface AttendanceChangeRow {
  registration_id: string;
  changed_at: string;
  from_type: string;
  to_type: string;
  day_date: string;
  day_label: string | null;
}

export interface AdminEventRegistrationsListParams {
  limit: number;
  offset: number;
  q?: AdminEventRegistrationsQuery["q"];
  status?: AdminEventRegistrationsQuery["status"];
  bounced?: AdminEventRegistrationsQuery["bounced"];
  consent?: AdminEventRegistrationsQuery["consent"];
  attendanceChange?: AdminEventRegistrationsQuery["attendance_change"];
  sort?: AdminEventRegistrationsQuery["sort"];
}

export interface AdminEventRegistrationSummary {
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
  has_bounced: boolean;
  sponsor_consent: boolean;
  custom_answers_json: string | null;
  dayWaitlistSummary: string | null;
  dayWaitlistCount: number;
  attendanceChangeHistory: AttendanceChangeHistoryEntry[];
  lastAttendanceChange: AttendanceChangeHistoryEntry | null;
}

export interface AttendanceChangeHistoryEntry {
  changedAt: string;
  transitions: Array<{ fromType: string; toType: string; days: Array<{ dayDate: string; label: string | null }> }>;
}

export interface AdminEventRegistrationsStats {
  byAttendanceType: Record<string, number>;
  attendanceStatusByType: Record<string, AttendanceStatusCount>;
  byStatus: Record<string, number>;
  bouncedCount: number;
  consentCount: number;
}

export interface AdminEventRegistrationsListResult {
  registrations: AdminEventRegistrationSummary[];
  total: number;
  stats: AdminEventRegistrationsStats;
}

const latestOutboxStatusForRegistrationSql = `(SELECT eo.status
       FROM email_outbox eo
       WHERE eo.recipient_user_id = r.user_id AND eo.event_id = r.event_id
       ORDER BY eo.updated_at DESC
       LIMIT 1)`;

export function buildAdminEventRegistrationsPageQuery(eventId: string, params: AdminEventRegistrationsListParams) {
  const search = (params.q ?? "").trim();
  const orderBy = resolveOrderBy(
    params.sort,
    EVENT_REGISTRATIONS_SORT_COLUMNS,
    "ORDER BY r.created_at DESC",
    "r.id ASC",
  );
  const attendanceChangeFilter = params.attendanceChange;

  const conditions: string[] = ["r.event_id = ?"];
  const bindings: unknown[] = [eventId];

  if (params.status) {
    conditions.push("r.status = ?");
    bindings.push(params.status);
  }

  if (params.bounced === "true") {
    conditions.push(`${latestOutboxStatusForRegistrationSql} = 'bounced'`);
  } else if (params.bounced === "false") {
    conditions.push(`COALESCE(${latestOutboxStatusForRegistrationSql}, '') <> 'bounced'`);
  }

  if (params.consent === "true") {
    conditions.push(
      "EXISTS(SELECT 1 FROM consent_acceptances ca WHERE ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing')",
    );
  } else if (params.consent === "false") {
    conditions.push(
      "NOT EXISTS(SELECT 1 FROM consent_acceptances ca WHERE ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing')",
    );
  }

  const hasAttendanceChange = (transition = "") => `EXISTS (
    SELECT 1
    FROM registration_attendance_history h
    WHERE h.registration_id = r.id
      AND h.event_day_id IS NOT NULL
      AND h.changed_by <> 'system'
      AND COALESCE(h.from_type, '') <> COALESCE(h.to_type, '')
      ${transition}
  )`;
  if (attendanceChangeFilter === "any") {
    conditions.push(hasAttendanceChange());
  } else if (attendanceChangeFilter === "left_in_person") {
    conditions.push("COALESCE(r.attendance_type, '') <> 'in_person'");
    conditions.push(
      hasAttendanceChange("AND h.from_type = 'in_person' AND COALESCE(h.to_type, 'not_attending') <> 'in_person'"),
    );
  } else if (attendanceChangeFilter === "joined_in_person") {
    conditions.push("r.attendance_type = 'in_person'");
    conditions.push(
      hasAttendanceChange("AND COALESCE(h.from_type, 'not_attending') <> 'in_person' AND h.to_type = 'in_person'"),
    );
  }

  if (search) {
    const filter = buildD1TextSearchFilter(search, [
      "u.email",
      "u.first_name",
      "u.last_name",
      "u.first_name || ' ' || u.last_name",
    ]);
    conditions.push(filter.sql);
    bindings.push(...filter.bindings);
  }

  const whereClause = conditions.join(" AND ");
  const orderBySql = attendanceChangeFilter
    ? `(SELECT MAX(h.changed_at)
        FROM registration_attendance_history h
        WHERE h.registration_id = r.id
          AND h.event_day_id IS NOT NULL
          AND h.changed_by <> 'system'
          AND COALESCE(h.from_type, '') <> COALESCE(h.to_type, '')) DESC,
       r.created_at DESC,
       r.id DESC`
    : "r.created_at DESC, r.id DESC";
  const pageOrderBy = attendanceChangeFilter ? `ORDER BY ${orderBySql}` : orderBy;
  return {
    source: {
      selectSql: `SELECT r.id, r.user_id, r.status, r.attendance_type, r.source_type, r.created_at, r.updated_at,
              u.email AS user_email,
              COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
              rc.code AS referral_code,
              COALESCE(${latestOutboxStatusForRegistrationSql} = 'bounced', 0) AS has_bounced,
              EXISTS(SELECT 1 FROM consent_acceptances ca
                     WHERE ca.registration_id = r.id AND ca.term_key = 'sponsor-data-sharing') AS sponsor_consent,
                   r.custom_answers_json,
              (SELECT JSON_GROUP_ARRAY(JSON_OBJECT(
                  'event_day_id', event_day_id,
                  'day_date', day_date,
                  'uid', ics_uid,
                  'status', response_status,
                  'received_at', received_at,
                  'warning_sent_at', warning_sent_at,
                  'action_executed_at', action_executed_at,
                  'action_taken', action_taken,
                  'raw_payload_json', raw_payload_json
              ))
               FROM (
                 SELECT event_day_id, day_date, ics_uid, response_status, received_at, warning_sent_at,
                        action_executed_at, action_taken, raw_payload_json,
                        ROW_NUMBER() OVER (
                          PARTITION BY event_day_id
                          ORDER BY julianday(received_at) DESC, id DESC
                        ) AS rn
                 FROM (
                   SELECT cre.event_day_id, ed.day_date, cre.ics_uid, cre.response_status, cre.received_at,
                          cre.warning_sent_at, cre.action_executed_at, cre.action_taken, cre.raw_payload_json, cre.id
                   FROM calendar_rsvp_events cre
                   LEFT JOIN event_days ed ON ed.id = cre.event_day_id
                   WHERE cre.registration_id = r.id
                 )
               )
               WHERE rn = 1
              ) AS rsvp_events_json`,
      fromSql: `FROM registrations r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN referral_codes rc ON rc.owner_type = 'registration' AND rc.owner_id = r.id
       WHERE ${whereClause}`,
      bindings,
    },
    orderBy: pageOrderBy,
    limit: params.limit,
    offset: params.offset,
  };
}

export async function listAdminEventRegistrations(
  db: DatabaseLike,
  eventId: string,
  params: AdminEventRegistrationsListParams,
): Promise<AdminEventRegistrationsListResult> {
  const { rows: registrationRows, total } = await queryPage<RegistrationRow>(
    db,
    buildAdminEventRegistrationsPageQuery(eventId, params),
  );

  const registrationIds = registrationRows.map((row) => row.id);
  const registrationFilter = buildD1JsonMembershipFilter("w.registration_id", registrationIds);
  const historyRegistrationFilter = buildD1JsonMembershipFilter("h.registration_id", registrationIds);
  const [waitlistSummaries, attendanceChangeRows] =
    registrationIds.length > 0
      ? await Promise.all([
          all<WaitlistSummaryRow>(
            db,
            `SELECT
           w.registration_id,
           GROUP_CONCAT(CASE
             WHEN ed.label IS NOT NULL AND ed.label <> '' THEN ed.label || ' (' || w.status || ')'
             ELSE ed.day_date || ' (' || w.status || ')'
           END, ' · ') AS summary,
           COUNT(*) AS count
         FROM event_day_waitlist_entries w
         LEFT JOIN event_days ed ON ed.id = w.event_day_id
         WHERE ${registrationFilter.sql}
           AND w.status IN ('waiting', 'offered')
         GROUP BY w.registration_id`,
            registrationFilter.bindings,
          ),
          all<AttendanceChangeRow>(
            db,
            `SELECT h.registration_id,
                    h.changed_at,
                    COALESCE(h.from_type, 'not_attending') AS from_type,
                    COALESCE(h.to_type, 'not_attending') AS to_type,
                    ed.day_date,
                    COALESCE(ed.label, ed.day_date) AS day_label
             FROM registration_attendance_history h
             JOIN event_days ed ON ed.id = h.event_day_id
             WHERE ${historyRegistrationFilter.sql}
               AND h.changed_by <> 'system'
               AND COALESCE(h.from_type, '') <> COALESCE(h.to_type, '')
             ORDER BY h.registration_id ASC, h.changed_at ASC, ed.sort_order ASC, ed.day_date ASC`,
            historyRegistrationFilter.bindings,
          ),
        ])
      : [[], []];

  const waitlistByRegistrationId = new Map(waitlistSummaries.map((row) => [row.registration_id, row]));
  const attendanceChangesByRegistrationId = new Map<string, AttendanceChangeHistoryEntry[]>();
  for (const row of attendanceChangeRows) {
    let history = attendanceChangesByRegistrationId.get(row.registration_id);
    if (!history) {
      history = [];
      attendanceChangesByRegistrationId.set(row.registration_id, history);
    }
    let change = history.at(-1);
    if (!change || change.changedAt !== row.changed_at) {
      change = { changedAt: row.changed_at, transitions: [] };
      history.push(change);
    }
    let transition = change.transitions.find((item) => item.fromType === row.from_type && item.toType === row.to_type);
    if (!transition) {
      transition = { fromType: row.from_type, toType: row.to_type, days: [] };
      change.transitions.push(transition);
    }
    transition.days.push({ dayDate: row.day_date, label: row.day_label });
  }

  const registrations = registrationRows.map((row) => {
    const summary = waitlistByRegistrationId.get(row.id);
    const attendanceChangeHistory = attendanceChangesByRegistrationId.get(row.id) ?? [];
    return {
      ...row,
      has_bounced: !!row.has_bounced,
      sponsor_consent: !!row.sponsor_consent,
      dayWaitlistSummary: summary?.summary ?? null,
      dayWaitlistCount: summary?.count ?? 0,
      attendanceChangeHistory,
      lastAttendanceChange: attendanceChangeHistory.at(-1) ?? null,
    };
  });

  const [statRows, bouncedCountRow, consentCountRow, attendanceStatusByType] = await Promise.all([
    // Aggregate stats always cover all registrations for the event (unfiltered)
    all<{ attendance_type: string; status: string; count: number }>(
      db,
      `SELECT attendance_type, status, COUNT(*) AS count
       FROM registrations WHERE event_id = ?
       GROUP BY attendance_type, status`,
      [eventId],
    ),
    first<{ bounced_count: number }>(
      db,
      `SELECT COUNT(DISTINCT r.id) AS bounced_count
       FROM registrations r
       WHERE r.event_id = ? AND ${latestOutboxStatusForRegistrationSql} = 'bounced'`,
      [eventId],
    ),
    first<{ consent_count: number }>(
      db,
      `SELECT COUNT(DISTINCT registration_id) AS consent_count
       FROM consent_acceptances
       WHERE event_id = ? AND term_key = 'sponsor-data-sharing'`,
      [eventId],
    ),
    getAttendanceStatusByType(db, eventId),
  ]);

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

  return {
    registrations,
    total,
    stats: {
      byAttendanceType,
      attendanceStatusByType,
      byStatus,
      bouncedCount: Number(bouncedCountRow?.bounced_count ?? 0),
      consentCount: Number(consentCountRow?.consent_count ?? 0),
    },
  };
}
