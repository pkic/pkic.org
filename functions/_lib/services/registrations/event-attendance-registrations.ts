import {
  eventAttendanceRegistrationSummarySchema,
  eventAttendanceRegistrationsStatsSchema,
  type EventAttendanceRegistrationSummary,
  type EventAttendanceRegistrationsQuery,
  type EventAttendanceRegistrationsStats,
} from "../../../../assets/shared/schemas/event-registrations";
import { all } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { registrationPopulationFilter } from "./registration-population-filter";
import type { DatabaseLike } from "../../types";
import { publicUserHeadshotPath } from "../user-headshot";
import { getAttendanceStatusByType } from "./attendance-statistics";
import { loadRegistrationDayStates } from "./day-states";
import { aggregateEventRegistrationStats, type EventRegistrationStatsRow } from "./event-registration-stats";
import { resolveEventRegistrationOrderBy } from "./event-registration-sort";

interface AttendanceRegistrationRow {
  id: string;
  user_id: string;
  status: string;
  attendance_type: string | null;
  created_at: string;
  updated_at: string;
  user_email: string | null;
  display_name: string | null;
  headshot_r2_key: string | null;
  organization_name: string | null;
  job_title: string | null;
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
  const population = registrationPopulationFilter(eventId, params);
  return {
    source: {
      selectSql: `SELECT r.id, r.user_id, r.status, r.attendance_type, r.created_at, r.updated_at,
                         u.email AS user_email,
                         COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
                         u.headshot_r2_key AS headshot_r2_key,
                         u.organization_name AS organization_name, u.job_title AS job_title`,
      ...population,
    },
    orderBy: resolveEventRegistrationOrderBy(params.sort),
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
  const [dayStates, statRows, attendanceStatusByType] = await Promise.all([
    loadRegistrationDayStates(
      db,
      rows.map((row) => row.id),
    ),
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
  const { byAttendanceType, byStatus } = aggregateEventRegistrationStats(statRows);
  return {
    registrations: rows.map((row) =>
      eventAttendanceRegistrationSummarySchema.parse({
        ...row,
        headshot_url: publicUserHeadshotPath(row.user_id, row.headshot_r2_key),
        days: dayStates.get(row.id) ?? [],
      }),
    ),
    total,
    stats: eventAttendanceRegistrationsStatsSchema.parse({ byAttendanceType, byStatus, attendanceStatusByType }),
  };
}
