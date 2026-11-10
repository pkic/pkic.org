import { sponsorConsentSql } from "../event-participation/sponsor-consent";
import { REGISTRATION_COUNTRY_SQL } from "./registration-country";
import { REGISTRATION_JOB_TITLE_SQL } from "./selected-identity";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { dayWaitlistStatusSql } from "./day-waitlist-policy";
import { REGISTRATION_ORGANIZATION_SQL } from "./selected-identity";
import type { EventAttendanceRegistrationsQuery } from "../../../../assets/shared/schemas/event-registrations";
import { buildD1TextSearchFilter } from "../../db/search";
import { registrationBadgeDisplayRoleSql } from "./badge-role";
import { activeDayWaitlistExistsSql, registrationWaitlistEntriesSql } from "./day-states";

/** One population predicate for registrations, exports, badges, and communications. */
export function registrationPopulationFilter(
  eventId: string,
  params: Pick<
    EventAttendanceRegistrationsQuery,
    | "consent"
    | "job_title"
    | "country"
    | "q"
    | "status"
    | "waitlisted"
    | "attendance_type"
    | "day_dates"
    | "day_match"
    | "badge_role"
    | "created_since"
  >,
  waitlistStatus?: "waiting" | "offered" | "accepted",
) {
  const conditions = ["r.event_id = ?"];
  const bindings: unknown[] = [eventId];
  if (params.consent)
    conditions.push(params.consent === "true" ? sponsorConsentSql("r") : `NOT ${sponsorConsentSql("r")}`);
  if (params.job_title) {
    const title = buildD1TextSearchFilter(params.job_title, [REGISTRATION_JOB_TITLE_SQL]);
    conditions.push(title.sql);
    bindings.push(...title.bindings);
  }
  if (params.country) {
    conditions.push(`${REGISTRATION_COUNTRY_SQL} = ?`);
    bindings.push(params.country);
  }
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
  const scopedToDay = Boolean(dates.length || params.attendance_type);
  const waitlistEntries = scopedToDay
    ? "FROM event_day_waitlist_entries w WHERE w.registration_id = r.id AND w.event_day_id = ed.id"
    : registrationWaitlistEntriesSql("r");
  const waitlistExists = (statusClause: string) =>
    `EXISTS (SELECT 1 ${waitlistEntries} AND ${dayWaitlistStatusSql("w")} ${statusClause})`;
  const dayWaitlist = waitlistExists("IN ('waiting', 'offered')");
  if (waitlistStatus) {
    (scopedToDay ? dayConditions : conditions).push(waitlistExists("= ?"));
    (scopedToDay ? dayBindings : bindings).push(waitlistStatus);
  }
  if ((dates.length || params.attendance_type) && params.waitlisted)
    dayConditions.push(params.waitlisted === "true" ? dayWaitlist : `NOT ${dayWaitlist}`);
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
  if (!dates.length && !params.attendance_type) {
    if (params.waitlisted === "true") conditions.push(activeDayWaitlistExistsSql("r"));
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
