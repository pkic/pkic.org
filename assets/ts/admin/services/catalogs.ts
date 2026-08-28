import type { z } from "zod";
import { rolesListResponseSchema, type Role } from "../../../shared/schemas/access-control";
import { adminEventsListResponseSchema, type AdminEventSummary } from "../../../shared/schemas/admin-events";
import { adminFormsListResponseSchema, type AdminFormSummary } from "../../../shared/schemas/admin-forms";
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

export function adminEventFormCatalog(
  eventSlug: string,
  purpose: EventFormsPurpose,
  status?: FormStatus,
): AdminCatalog<AdminFormSummary, z.infer<typeof adminFormsListResponseSchema>> {
  return {
    endpoint: `/api/v1/admin/events/${encodeURIComponent(eventSlug)}/forms`,
    responseSchema: adminFormsListResponseSchema,
    resolveItems: (response) => response.forms,
    resolvePage: (response) => response.page,
    itemKey: (item) => item.key,
    itemLabel: (item) => (item.event_name ? `${item.title} · ${item.event_name}` : item.title),
    params: { purpose, ...(status ? { status } : {}) },
    sort: "title",
  };
}

export const adminEventCatalog: AdminCatalog<AdminEventSummary, z.infer<typeof adminEventsListResponseSchema>> = {
  endpoint: "/api/v1/admin/events",
  responseSchema: adminEventsListResponseSchema,
  resolveItems: (response) => response.events,
  resolvePage: (response) => response.page,
  itemKey: (item) => item.id,
  itemLabel: (item) => item.name,
  sort: "name",
};

export const adminRoleCatalog: AdminCatalog<Role, z.infer<typeof rolesListResponseSchema>> = {
  endpoint: "/api/v1/admin/roles",
  responseSchema: rolesListResponseSchema,
  resolveItems: (response) => response.roles,
  resolvePage: (response) => response.page,
  itemKey: (item) => item.id,
  itemLabel: (item) => item.name,
  sort: "name",
};
