import type { z } from "zod";
import { rolesListResponseSchema, type Role } from "../../../shared/schemas/access-control";
import {
  adminEmailTemplatesListResponseSchema,
  adminEmailTemplateVersionsListResponseSchema,
  type AdminEmailTemplateSummary,
  type AdminEmailTemplateVersion,
} from "../../../shared/schemas/admin-email-templates";
import { adminEventsListResponseSchema, type AdminEventSummary } from "../../../shared/schemas/admin-events";
import { adminFormsListResponseSchema, type AdminFormSummary } from "../../../shared/schemas/admin-forms";
import { groupsListResponseSchema, type Group } from "../../../shared/schemas/groups";
import type { EventFormsPurpose, FormStatus } from "../../../shared/schemas/forms";
import type { ServerCatalog } from "../../shared/server-catalog";
import { api } from "../api";

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

export function adminEmailTemplateCatalog(
  templateKeyPrefix?: string,
): AdminCatalog<AdminEmailTemplateSummary, z.infer<typeof adminEmailTemplatesListResponseSchema>> {
  return {
    endpoint: "/api/v1/admin/email-templates",
    responseSchema: adminEmailTemplatesListResponseSchema,
    resolveItems: (response) => response.templates,
    resolvePage: (response) => response.page,
    itemKey: (item) => item.template_key,
    itemLabel: (item) => item.template_key,
    params: templateKeyPrefix ? { templateKeyPrefix } : undefined,
    sort: "template_key",
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

async function loadTemplateVersionPage(
  templateKey: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<AdminEmailTemplateVersion[]> {
  const query = new URLSearchParams({ limit: "1", offset: "0", sort: "-version", ...params });
  const raw = await api(
    `/api/v1/admin/email-templates/${encodeURIComponent(templateKey)}/versions?${query.toString()}`,
    adminEmailTemplateVersionsListResponseSchema,
    { signal },
  );
  return raw.versions;
}

/** Loads only the active editor version, or the latest draft when no version is active. */
export async function getAdminEmailTemplateEditorVersion(
  templateKey: string,
  signal?: AbortSignal,
): Promise<AdminEmailTemplateVersion | null> {
  const active = await loadTemplateVersionPage(templateKey, { status: "active" }, signal);
  if (active[0]) return active[0];
  const latest = await loadTemplateVersionPage(templateKey, {}, signal);
  return latest[0] ?? null;
}
