import {
  EVENT_REGISTRATIONS_SORT_COLUMNS,
  eventAttendanceRegistrationSummarySchema,
  eventAttendanceRegistrationsStatsSchema,
  type EventAttendanceRegistrationSummary,
  type EventAttendanceRegistrationsQuery,
  type EventAttendanceRegistrationsStats,
} from "../../../../assets/shared/schemas/event-registrations";
import { all } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { getAttendanceStatusByType } from "./attendance-statistics";
import { aggregateEventRegistrationStats, type EventRegistrationStatsRow } from "./event-registration-stats";

interface AttendanceRegistrationRow {
  id: string;
  user_id: string;
  status: string;
  attendance_type: string | null;
  created_at: string;
  updated_at: string;
  user_email: string | null;
  display_name: string | null;
}

interface WaitlistSummaryRow {
  registration_id: string;
  summary: string | null;
  count: number;
}

export interface EventAttendanceRegistrationsListResult {
  registrations: EventAttendanceRegistrationSummary[];
  total: number;
  stats: EventAttendanceRegistrationsStats;
}

/**
 * Builds the bounded attendance-manager query using the same shared
 * search/sort/page primitives as the full administrator list, but never reads
 * administrator-only columns from D1.
 */
export function buildEventAttendanceRegistrationsPageQuery(eventId: string, params: EventAttendanceRegistrationsQuery) {
  const conditions = ["r.event_id = ?"];
  const bindings: unknown[] = [eventId];
  if (params.status) {
    conditions.push("r.status = ?");
    bindings.push(params.status);
  }
  const search = (params.q ?? "").trim();
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
  return {
    source: {
      selectSql: `SELECT r.id, r.user_id, r.status, r.attendance_type, r.created_at, r.updated_at,
                         u.email AS user_email,
                         COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name`,
      fromSql: `FROM registrations r
                LEFT JOIN users u ON u.id = r.user_id
                WHERE ${conditions.join(" AND ")}`,
      bindings,
    },
    orderBy: resolveOrderBy(params.sort, EVENT_REGISTRATIONS_SORT_COLUMNS, "ORDER BY r.created_at DESC", "r.id ASC"),
    limit: params.limit,
    offset: params.offset,
  };
}

export async function listEventAttendanceRegistrations(
  db: DatabaseLike,
  eventId: string,
  params: EventAttendanceRegistrationsQuery,
): Promise<EventAttendanceRegistrationsListResult> {
  const { rows, total } = await queryPage<AttendanceRegistrationRow>(
    db,
    buildEventAttendanceRegistrationsPageQuery(eventId, params),
  );
  const registrationFilter = buildD1JsonMembershipFilter(
    "w.registration_id",
    rows.map((row) => row.id),
  );
  const [waitlistSummaries, statRows, attendanceStatusByType] = await Promise.all([
    rows.length
      ? all<WaitlistSummaryRow>(
          db,
          `SELECT w.registration_id,
                  GROUP_CONCAT(CASE
                    WHEN ed.label IS NOT NULL AND ed.label <> '' THEN ed.label || ' (' || w.status || ')'
                    ELSE ed.day_date || ' (' || w.status || ')'
                  END, ' · ') AS summary,
                  COUNT(*) AS count
             FROM event_day_waitlist_entries w
             JOIN event_days ed ON ed.id = w.event_day_id
            WHERE ${registrationFilter.sql}
              AND w.status IN ('waiting', 'offered')
            GROUP BY w.registration_id`,
          registrationFilter.bindings,
        )
      : Promise.resolve([]),
    all<EventRegistrationStatsRow>(
      db,
      `SELECT attendance_type, status, COUNT(*) AS count
         FROM registrations
        WHERE event_id = ?
        GROUP BY attendance_type, status`,
      [eventId],
    ),
    getAttendanceStatusByType(db, eventId),
  ]);
  const waitlistByRegistrationId = new Map(waitlistSummaries.map((row) => [row.registration_id, row]));
  const { byAttendanceType, byStatus } = aggregateEventRegistrationStats(statRows);
  return {
    registrations: rows.map((row) => {
      const waitlist = waitlistByRegistrationId.get(row.id);
      return eventAttendanceRegistrationSummarySchema.parse({
        ...row,
        dayWaitlistSummary: waitlist?.summary ?? null,
        dayWaitlistCount: Number(waitlist?.count ?? 0),
      });
    }),
    total,
    stats: eventAttendanceRegistrationsStatsSchema.parse({ byAttendanceType, byStatus, attendanceStatusByType }),
  };
}
