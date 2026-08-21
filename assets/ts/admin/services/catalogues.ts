import { workingGroupsListResponseSchema, type AdminWorkingGroupSummary } from "../../../shared/schemas/working-groups";
import { adminFormsListResponseSchema, type AdminFormSummary } from "../../../shared/schemas/admin-forms";
import {
  adminEmailTemplatesListResponseSchema,
  type AdminEmailTemplateSummary,
} from "../../../shared/schemas/admin-email-templates";
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

export async function getAdminEventFormCatalogue(
  eventSlug: string,
  purpose: "event_registration" | "proposal_submission",
): Promise<AdminFormSummary[]> {
  const query = new URLSearchParams({ purpose, limit: "200", sort: "title" });
  const raw = await api<unknown>(`/api/v1/admin/events/${encodeURIComponent(eventSlug)}/forms?${query.toString()}`);
  const result = adminFormsListResponseSchema.parse(raw);
  if (result.page.hasMore) {
    throw new Error("The event form catalogue exceeds 200 entries; use a searchable selector.");
  }
  return result.forms;
}

export async function getAdminEmailTemplateCatalogue(): Promise<AdminEmailTemplateSummary[]> {
  const raw = await api<unknown>("/api/v1/admin/email-templates?limit=200&sort=template_key");
  const result = adminEmailTemplatesListResponseSchema.parse(raw);
  if (result.page.hasMore) {
    throw new Error("The email-template catalogue exceeds 200 entries; use a searchable selector.");
  }
  return result.templates;
}
