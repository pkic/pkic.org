import { REGISTRATION_ORGANIZATION_SQL, REGISTRATION_JOB_TITLE_SQL } from "./selected-identity";
/**
 * Bounded, set-based event-registration read model. Both the retiring admin
 * routes and group-context routes consume this one query and projection.
 */
import { all, first } from "../../db/queries";
import { publicUserHeadshotPath } from "../user-headshot";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { loadRegistrationAttendanceChanges } from "./attendance-history";
import { getAttendanceStatusByType } from "./attendance-statistics";
import { activeDayWaitlistExistsSql, loadRegistrationDayStates } from "./day-states";
import { firstReferralCodeForOwnerSql } from "../referral-code-projection";
import {
  eventRegistrationSummarySchema,
  eventRegistrationsStatsSchema,
  type EventRegistrationSummary,
  type EventRegistrationsStats,
  type EventRegistrationsQuery,
} from "../../../../assets/shared/schemas/event-registrations";
import type { DatabaseLike } from "../../types";
import { aggregateEventRegistrationStats, type EventRegistrationStatsRow } from "./event-registration-stats";
import { resolveEventRegistrationOrderBy } from "./event-registration-sort";
import { sponsorConsentSql } from "../event-participation/sponsor-consent";

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
  headshot_r2_key: string | null;
  organization_name: string | null;
  job_title: string | null;
  referral_code: string | null;
  rsvp_events_json: string | null;
  has_bounced: number;
  sponsor_consent: number;
  custom_answers_json: string | null;
}

export interface EventRegistrationsListResult {
  registrations: EventRegistrationSummary[];
  total: number;
  stats: EventRegistrationsStats;
}

const latestOutboxStatusForRegistrationSql = `(SELECT eo.status
       FROM email_outbox eo
       WHERE eo.recipient_user_id = r.user_id AND eo.event_id = r.event_id
       ORDER BY eo.updated_at DESC
       LIMIT 1)`;
const registrationReferralCodeSql = firstReferralCodeForOwnerSql("registration", "r.id");

export function buildEventRegistrationsPageQuery(eventId: string, params: EventRegistrationsQuery) {
  const search = (params.q ?? "").trim();
  const orderBy = resolveEventRegistrationOrderBy(params.sort);
  const attendanceChangeFilter = params.attendance_change;

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

  if (params.waitlisted === "true") conditions.push(activeDayWaitlistExistsSql("r"));
  else if (params.waitlisted === "false") conditions.push(`NOT ${activeDayWaitlistExistsSql("r")}`);

  if (params.consent === "true") {
    conditions.push(sponsorConsentSql("r"));
  } else if (params.consent === "false") {
    conditions.push(`NOT ${sponsorConsentSql("r")}`);
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
              u.headshot_r2_key AS headshot_r2_key,
              ${REGISTRATION_ORGANIZATION_SQL} AS organization_name, ${REGISTRATION_JOB_TITLE_SQL} AS job_title,
              ${registrationReferralCodeSql} AS referral_code,
              COALESCE(${latestOutboxStatusForRegistrationSql} = 'bounced', 0) AS has_bounced,
              ${sponsorConsentSql("r")} AS sponsor_consent,
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
       WHERE ${whereClause}`,
      bindings,
    },
    orderBy: pageOrderBy,
    limit: params.limit,
    offset: params.offset,
  };
}

export async function listEventRegistrations(
  db: DatabaseLike,
  eventId: string,
  params: EventRegistrationsQuery,
): Promise<EventRegistrationsListResult> {
  const { rows: registrationRows, total } = await queryPage<RegistrationRow>(
    db,
    buildEventRegistrationsPageQuery(eventId, params),
  );

  const registrationIds = registrationRows.map((row) => row.id);
  const [dayStates, attendanceChangesByRegistrationId] = await Promise.all([
    registrationIds.length > 0 ? loadRegistrationDayStates(db, registrationIds) : new Map(),
    loadRegistrationAttendanceChanges(db, eventId, registrationIds),
  ]);

  const registrations = registrationRows.map((row) => {
    const attendanceChangeHistory = attendanceChangesByRegistrationId.get(row.id) ?? [];
    return {
      ...row,
      headshot_url: publicUserHeadshotPath(row.user_id, row.headshot_r2_key),
      has_bounced: !!row.has_bounced,
      sponsor_consent: !!row.sponsor_consent,
      days: dayStates.get(row.id) ?? [],
      attendanceChangeHistory,
      lastAttendanceChange: attendanceChangeHistory.at(-1) ?? null,
    };
  });

  const [statRows, bouncedCountRow, consentCountRow, attendanceStatusByType] = await Promise.all([
    // Aggregate stats always cover all registrations for the event (unfiltered)
    all<EventRegistrationStatsRow>(
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
      `SELECT COUNT(*) AS consent_count FROM registrations r
       WHERE r.event_id = ? AND ${sponsorConsentSql("r")}`,
      [eventId],
    ),
    getAttendanceStatusByType(db, eventId),
  ]);

  const { byAttendanceType, byStatus } = aggregateEventRegistrationStats(statRows);

  return {
    registrations: registrations.map((registration) => eventRegistrationSummarySchema.parse(registration)),
    total,
    stats: eventRegistrationsStatsSchema.parse({
      byAttendanceType,
      attendanceStatusByType,
      byStatus,
      bouncedCount: Number(bouncedCountRow?.bounced_count ?? 0),
      consentCount: Number(consentCountRow?.consent_count ?? 0),
    }),
  };
}
