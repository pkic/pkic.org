import type { RegistrationDayState } from "../../../../assets/shared/schemas/event-registrations";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";

interface RegistrationDayStateRow {
  registration_id: string;
  day_date: string;
  label: string | null;
  attendance_type: string;
  waitlist_status: "waiting" | "offered" | null;
}

/**
 * A registration that is still waiting for, or has been offered, an in-person
 * seat on at least one day. `alias` is the registrations table's alias in the
 * enclosing query; the fragment is trusted SQL owned by the list services.
 */
export function activeDayWaitlistExistsSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM event_day_waitlist_entries w
                  WHERE w.registration_id = ${alias}.id AND w.status IN ('waiting', 'offered'))`;
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
            (SELECT w.status
               FROM event_day_waitlist_entries w
              WHERE w.registration_id = rda.registration_id
                AND w.event_day_id = rda.event_day_id
                AND w.status IN ('waiting', 'offered')
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
      waitlistStatus: row.waitlist_status,
    });
    states.set(row.registration_id, days);
  }
  return states;
}
