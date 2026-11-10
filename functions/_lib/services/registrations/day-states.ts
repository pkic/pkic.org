import type { RegistrationDayState } from "../../../../assets/shared/schemas/event-registrations";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { attendanceOptionLabelSql } from "../event-attendance-option-sql";
import { dayWaitlistStatusSql } from "./day-waitlist-policy";

interface RegistrationDayStateRow {
  registration_id: string;
  day_date: string;
  label: string | null;
  attendance_type: string;
  option_label: string | null;
  waitlist_status: "waiting" | "offered" | "expired" | null;
}

/**
 * A registration's waitlist entries, reached through its event's days: entries are indexed by day and
 * registration, so starting from the registration alone would scan the whole queue once per registration.
 * Ends in an open WHERE clause so callers append their status condition.
 */
export function registrationWaitlistEntriesSql(alias: string): string {
  return `FROM event_days waitlist_day
          JOIN event_day_waitlist_entries w ON w.event_day_id = waitlist_day.id AND w.registration_id = ${alias}.id
          WHERE waitlist_day.event_id = ${alias}.event_id`;
}

/**
 * A registration that is still waiting for, or has been offered, an in-person
 * seat on at least one day. `alias` is the registrations table's alias in the
 * enclosing query; the fragment is trusted SQL owned by the list services.
 */
export function activeDayWaitlistExistsSql(alias: string): string {
  return `EXISTS (SELECT 1 ${registrationWaitlistEntriesSql(alias)}
                  AND ${dayWaitlistStatusSql("w")} IN ('waiting', 'offered'))`;
}

/** Match an option selected on at least one day. */
export function selectedAttendanceTypeSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM registration_day_attendance selected_day
    WHERE selected_day.registration_id = ${alias}.id AND selected_day.attendance_type = ?)`;
}

/**
 * The per-day state of one page of registrations, in one bounded read.
 *
 * A waitlisted day keeps its in-person attendance row — the choice stands,
 * the seat does not — so the attendance rows are the spine and the day's
 * active waitlist entry, when there is one, is read beside it. Days come back
 * in the event's own order.
 */
export async function loadRegistrationDayStates(
  db: DatabaseLike,
  registrationIds: readonly string[],
): Promise<Map<string, RegistrationDayState[]>> {
  const states = new Map<string, RegistrationDayState[]>();
  if (registrationIds.length === 0) return states;
  const filter = buildD1JsonMembershipFilter("rda.registration_id", registrationIds);
  const rows = await all<RegistrationDayStateRow>(
    db,
    `SELECT rda.registration_id,
            ed.day_date,
            ed.label,
            rda.attendance_type,
            ${attendanceOptionLabelSql("ed", "rda.attendance_type")} AS option_label,
            (SELECT ${dayWaitlistStatusSql("w")}
               FROM event_day_waitlist_entries w
              WHERE w.registration_id = rda.registration_id
                AND w.event_day_id = rda.event_day_id
                AND w.status IN ('waiting', 'offered', 'expired')
              LIMIT 1) AS waitlist_status
       FROM registration_day_attendance rda
       JOIN event_days ed ON ed.id = rda.event_day_id
      WHERE ${filter.sql}
      ORDER BY rda.registration_id ASC, ed.sort_order ASC, ed.day_date ASC`,
    filter.bindings,
  );
  for (const row of rows) {
    const days = states.get(row.registration_id) ?? [];
    days.push({
      dayDate: row.day_date,
      label: row.label,
      attendanceType: row.attendance_type,
      ...(row.option_label ? { optionLabel: row.option_label } : {}),
      waitlistStatus: row.waitlist_status,
    });
    states.set(row.registration_id, days);
  }
  return states;
}
