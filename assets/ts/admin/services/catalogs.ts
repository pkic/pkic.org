import type { z } from "zod";
import { formsListResponseSchema, type FormSummary } from "../../../shared/schemas/form-management";
import { groupsListResponseSchema, type Group } from "../../../shared/schemas/groups";
import type { EventFormsPurpose, FormStatus } from "../../../shared/schemas/forms";
import type { ServerCatalog } from "../../shared/server-catalog";

/**
 * Runtime-validated metadata for one server-backed selector. Every catalogue
 * uses the same q/sort/limit/offset transport instead of loading an arbitrary
 * first 200 rows and treating that page as a complete data set.
 */
export type AdminCatalog<Item, Response> = ServerCatalog<Item, Response>;

export const adminGroupCatalog: AdminCatalog<Group, z.infer<typeof groupsListResponseSchema>> = {
  endpoint: "/api/v1/groups",
  responseSchema: groupsListResponseSchema,
  resolveItems: (response) => response.groups,
  resolvePage: (response) => response.page,
  itemKey: (item) => item.id,
  itemLabel: (item) => `${item.name} (${item.type.singularLabel})${item.active ? "" : " — inactive"}`,
  sort: "name",
};

export function activeAdminGroupCatalog(): typeof adminGroupCatalog {
  return { ...adminGroupCatalog, params: { active: "true" } };
}

export function activeAdminWorkingGroupCatalog(): typeof adminGroupCatalog {
  return { ...adminGroupCatalog, params: { active: "true", typeKey: "working_group" } };
}

export function eventFormCatalog(
  eventSlug: string,
  purpose: EventFormsPurpose,
  status?: FormStatus,
): AdminCatalog<FormSummary, z.infer<typeof formsListResponseSchema>> {
  return {
    endpoint: `/api/v1/events/${encodeURIComponent(eventSlug)}/forms`,
    responseSchema: formsListResponseSchema,
    resolveItems: (response) => response.forms,
    resolvePage: (response) => response.page,
    itemKey: (item) => item.key,
    itemLabel: (item) => (item.event_name ? `${item.title} · ${item.event_name}` : item.title),
    params: { purpose, ...(status ? { status } : {}) },
    sort: "title",
  };
}
