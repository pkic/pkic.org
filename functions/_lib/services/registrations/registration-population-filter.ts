import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { dayWaitlistStatusSql } from "./day-waitlist-policy";
import { REGISTRATION_ORGANIZATION_SQL } from "./selected-identity";
import type { EventAttendanceRegistrationsQuery } from "../../../../assets/shared/schemas/event-registrations";
import { buildD1TextSearchFilter } from "../../db/search";
import { registrationBadgeDisplayRoleSql } from "./badge-role";
import { activeDayWaitlistExistsSql } from "./day-states";

/** One predicate for the group registration table and its badge-print population. */
export function registrationPopulationFilter(
  eventId: string,
  params: Pick<
    EventAttendanceRegistrationsQuery,
    "q" | "status" | "waitlisted" | "attendance_type" | "day_dates" | "day_match" | "badge_role" | "created_since"
  >,
) {
  const conditions = ["r.event_id = ?"];
  const bindings: unknown[] = [eventId];
  if (params.status) {
    conditions.push("r.status = ?");
    bindings.push(params.status);
  }
  if (params.created_since) {
    conditions.push("r.created_at >= ?");
    bindings.push(params.created_since);
  }
  const dates = params.day_dates?.split(",") ?? [];
  const dayConditions = ["selected_day.registration_id = r.id", "ed.event_id = r.event_id"];
  const dayBindings: unknown[] = [];
  if (dates.length) {
    const selectedDates = buildD1JsonMembershipFilter("ed.day_date", dates);
    dayConditions.push(selectedDates.sql, "selected_day.attendance_type <> 'not_attending'");
    dayBindings.push(...selectedDates.bindings);
  }
  if (params.attendance_type) {
    dayConditions.push("selected_day.attendance_type = ?");
    dayBindings.push(params.attendance_type);
  }
  const dayWaitlist = `EXISTS (SELECT 1 FROM event_day_waitlist_entries w
    WHERE w.registration_id = r.id AND w.event_day_id = ed.id
      AND ${dayWaitlistStatusSql("w")} IN ('waiting', 'offered'))`;
  if (dates.length && params.waitlisted)
    dayConditions.push(params.waitlisted === "true" ? dayWaitlist : `NOT ${dayWaitlist}`);
  else if (params.attendance_type && params.waitlisted === "true") dayConditions.push(dayWaitlist);
  if (dates.length || params.attendance_type) {
    const matchedDays = `FROM registration_day_attendance selected_day
      JOIN event_days ed ON ed.id = selected_day.event_day_id WHERE ${dayConditions.join(" AND ")}`;
    conditions.push(
      dates.length && params.day_match === "all"
        ? `(SELECT COUNT(DISTINCT ed.id) ${matchedDays}) = ?`
        : `EXISTS (SELECT 1 ${matchedDays})`,
    );
    bindings.push(...dayBindings, ...(dates.length && params.day_match === "all" ? [dates.length] : []));
  }
  if (params.badge_role) {
    conditions.push(`${registrationBadgeDisplayRoleSql("r")} = ?`);
    bindings.push(params.badge_role);
  }
  if (!dates.length) {
    if (params.waitlisted === "true" && !params.attendance_type) conditions.push(activeDayWaitlistExistsSql("r"));
    else if (params.waitlisted === "false") conditions.push(`NOT ${activeDayWaitlistExistsSql("r")}`);
  }
  const search = (params.q ?? "").trim();
  if (search) {
    const filter = buildD1TextSearchFilter(search, [
      "u.email",
      REGISTRATION_ORGANIZATION_SQL,
      "u.first_name",
      "u.last_name",
      "u.first_name || ' ' || u.last_name",
    ]);
    conditions.push(filter.sql);
    bindings.push(...filter.bindings);
  }
  return {
    fromSql: `FROM registrations r LEFT JOIN users u ON u.id = r.user_id WHERE ${conditions.join(" AND ")}`,
    bindings,
  };
}
