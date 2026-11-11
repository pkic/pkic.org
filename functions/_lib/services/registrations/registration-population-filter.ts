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
    | "attendance_match"
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
    const statuses = buildD1JsonMembershipFilter("r.status", params.status.split(","));
    conditions.push(statuses.sql);
    bindings.push(...statuses.bindings);
  }
  if (params.created_since) {
    conditions.push("r.created_at >= ?");
    bindings.push(params.created_since);
  }
  const dates = params.day_dates?.split(",") ?? [];
  const types = params.attendance_type?.split(",") ?? [];
  const scopedToDay = Boolean(dates.length || types.length);
  // What a matching day must be, whatever its attendance type.
  const dayConditions = ["selected_day.registration_id = r.id", "ed.event_id = r.event_id"];
  const dayBindings: unknown[] = [];
  if (dates.length) {
    const selectedDates = buildD1JsonMembershipFilter("ed.day_date", dates);
    dayConditions.push(selectedDates.sql, "selected_day.attendance_type <> 'not_attending'");
    dayBindings.push(...selectedDates.bindings);
  }
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
  if (scopedToDay && params.waitlisted)
    dayConditions.push(params.waitlisted === "true" ? dayWaitlist : `NOT ${dayWaitlist}`);
  const matchedDays = (typeSql?: string) => `FROM registration_day_attendance selected_day
      JOIN event_days ed ON ed.id = selected_day.event_day_id
      WHERE ${[...dayConditions, ...(typeSql ? [typeSql] : [])].join(" AND ")}`;
  if (scopedToDay) {
    const selectedTypes = types.length ? buildD1JsonMembershipFilter("selected_day.attendance_type", types) : null;
    conditions.push(
      dates.length && params.day_match === "all"
        ? `(SELECT COUNT(DISTINCT ed.id) ${matchedDays(selectedTypes?.sql)}) = ?`
        : `EXISTS (SELECT 1 ${matchedDays(selectedTypes?.sql)})`,
    );
    bindings.push(
      ...dayBindings,
      ...(selectedTypes?.bindings ?? []),
      ...(dates.length && params.day_match === "all" ? [dates.length] : []),
    );
    // "All selected types": each type on at least one of the matching days.
    if (types.length > 1 && params.attendance_match === "all")
      for (const type of types) {
        conditions.push(`EXISTS (SELECT 1 ${matchedDays("selected_day.attendance_type = ?")})`);
        bindings.push(...dayBindings, type);
      }
  }
  if (params.badge_role) {
    conditions.push(`${registrationBadgeDisplayRoleSql("r")} = ?`);
    bindings.push(params.badge_role);
  }
  if (!scopedToDay) {
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
