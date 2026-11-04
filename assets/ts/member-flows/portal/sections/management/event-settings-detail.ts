import { eventManagementDetailResponseSchema } from "../../../../../shared/schemas/event-management";
import { getJson } from "../../../../shared/api-client";

/** Group configuration uses the same selected context for reads and writes. */
export function readEventSettings(slug: string, groupId?: string) {
  const query = groupId ? `?groupId=${encodeURIComponent(groupId)}` : "";
  return getJson(`/api/v1/events/${encodeURIComponent(slug)}${query}`, eventManagementDetailResponseSchema);
}
