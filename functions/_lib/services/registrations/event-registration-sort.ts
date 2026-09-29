import { resolveMappedOrderBy } from "../../db/sort";

const EVENT_REGISTRATION_SORT_EXPRESSIONS = {
  display_name: "COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) COLLATE NOCASE",
  status: "r.status",
  attendance_type: "r.attendance_type",
  created_at: "r.created_at",
} as const;

/** Shared SQL mapping for every event-registration list contract. */
export function resolveEventRegistrationOrderBy(sort: string | undefined): string {
  return resolveMappedOrderBy(sort, EVENT_REGISTRATION_SORT_EXPRESSIONS, "r.created_at DESC", "r.id ASC");
}
