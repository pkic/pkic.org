import { workingGroupsListResponseSchema, type AdminWorkingGroupSummary } from "../../../shared/schemas/working-groups";
import { api } from "../api";

/**
 * Loads the bounded working-group catalogue used by selectors. Management
 * tables use the same endpoint's normal page contract; selectors fail
 * visibly instead of silently omitting options if the catalogue outgrows
 * the shared maximum page size.
 */
export async function getAdminWorkingGroupCatalogue(): Promise<AdminWorkingGroupSummary[]> {
  const raw = await api<unknown>("/api/v1/admin/working-groups?limit=200&sort=name");
  const result = workingGroupsListResponseSchema.parse(raw);
  if (result.page.hasMore) {
    throw new Error("The working-group catalogue exceeds 200 entries; use a searchable selector.");
  }
  return result.workingGroups;
}
