import type { EventAttendanceRegistrationsQuery } from "../../../../assets/shared/schemas/event-registrations";
import { buildD1TextSearchFilter } from "../../db/search";
import { activeDayWaitlistExistsSql } from "./day-states";

/** One predicate for the group registration table and its badge-print population. */
export function registrationPopulationFilter(
  eventId: string,
  params: Pick<EventAttendanceRegistrationsQuery, "q" | "status" | "waitlisted">,
) {
  const conditions = ["r.event_id = ?"];
  const bindings: unknown[] = [eventId];
  if (params.status) {
    conditions.push("r.status = ?");
    bindings.push(params.status);
  }
  if (params.waitlisted === "true") conditions.push(activeDayWaitlistExistsSql("r"));
  else if (params.waitlisted === "false") conditions.push(`NOT ${activeDayWaitlistExistsSql("r")}`);
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
    fromSql: `FROM registrations r LEFT JOIN users u ON u.id = r.user_id WHERE ${conditions.join(" AND ")}`,
    bindings,
  };
}
