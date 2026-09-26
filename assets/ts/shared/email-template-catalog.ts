import type { z } from "zod";
import {
  emailTemplatesListResponseSchema,
  emailTemplateVersionsListResponseSchema,
  type EmailTemplateSummary,
  type EmailTemplateVersion,
} from "../../shared/schemas/email-templates";
import { getJson } from "./api-client";
import type { ServerCatalog } from "./server-catalog";

export const EMAIL_TEMPLATES_API = "/api/v1/email/templates";

export function emailTemplateCatalog(
  templateKeyPrefix?: string,
): ServerCatalog<EmailTemplateSummary, z.infer<typeof emailTemplatesListResponseSchema>> {
  return {
    endpoint: EMAIL_TEMPLATES_API,
    responseSchema: emailTemplatesListResponseSchema,
    resolveItems: (response) => response.templates,
    resolvePage: (response) => response.page,
    itemKey: (item) => item.template_key,
    itemLabel: (item) => item.template_key,
    params: templateKeyPrefix ? { templateKeyPrefix } : undefined,
    sort: "template_key",
  };
}

async function loadTemplateVersionPage(
  templateKey: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<EmailTemplateVersion[]> {
  const query = new URLSearchParams({ limit: "1", offset: "0", sort: "-version", ...params });
  const response = await getJson(
    `${EMAIL_TEMPLATES_API}/${encodeURIComponent(templateKey)}/versions?${query.toString()}`,
    emailTemplateVersionsListResponseSchema,
    { signal },
  );
  return response.versions;
}

/** Loads only the active editor version, or the latest draft when none is active. */
export async function getEmailTemplateEditorVersion(
  templateKey: string,
  signal?: AbortSignal,
): Promise<EmailTemplateVersion | null> {
  const active = await loadTemplateVersionPage(templateKey, { status: "active" }, signal);
  if (active[0]) return active[0];
  const latest = await loadTemplateVersionPage(templateKey, {}, signal);
  return latest[0] ?? null;
}
