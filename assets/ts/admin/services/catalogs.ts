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
import type { PageInfo } from "../../../shared/schemas/pagination";
import { workingGroupsListResponseSchema, type AdminWorkingGroupSummary } from "../../../shared/schemas/working-groups";
import { api } from "../api";

/**
 * Runtime-validated metadata for one server-backed selector. Every catalogue
 * uses the same q/sort/limit/offset transport instead of loading an arbitrary
 * first 200 rows and treating that page as a complete data set.
 */
export interface AdminCatalog<Item, Response> {
  endpoint: string;
  responseSchema: z.ZodType<Response>;
  resolveItems: (response: Response) => Item[];
  resolvePage: (response: Response) => PageInfo;
  itemKey: (item: Item) => string;
  itemLabel: (item: Item) => string;
  params?: Record<string, string>;
  sort: string;
}

export const adminWorkingGroupCatalog: AdminCatalog<
  AdminWorkingGroupSummary,
  z.infer<typeof workingGroupsListResponseSchema>
> = {
  endpoint: "/api/v1/admin/working-groups",
  responseSchema: workingGroupsListResponseSchema,
  resolveItems: (response) => response.workingGroups,
  resolvePage: (response) => response.page,
  itemKey: (item) => item.id,
  itemLabel: (item) => `${item.name}${item.active ? "" : " (inactive)"}`,
  sort: "name",
};

export function activeAdminWorkingGroupCatalog(): typeof adminWorkingGroupCatalog {
  return { ...adminWorkingGroupCatalog, params: { active: "true" } };
}

export function adminEventFormCatalog(
  eventSlug: string,
  purpose: "event_registration" | "proposal_submission",
  status?: "active" | "inactive" | "archived",
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
  const raw = await api<unknown>(
    `/api/v1/admin/email-templates/${encodeURIComponent(templateKey)}/versions?${query.toString()}`,
    { signal },
  );
  return adminEmailTemplateVersionsListResponseSchema.parse(raw).versions;
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
