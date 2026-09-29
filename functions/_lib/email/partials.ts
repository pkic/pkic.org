import type { DatabaseLike } from "../types";
import {
  requireResolvedTemplates,
  resolveTemplate,
  resolveTemplateSet,
  type EmailTemplateResolution,
  type ResolvedEmailTemplate,
} from "./templates";

export const EMAIL_LAYOUT_TEMPLATE_KEY = "email_layout";
export const EMAIL_PARTIAL_NAMES = ["reg_details", "sponsors_block", "about_pkic", "donation_request"] as const;
export const EMAIL_PARTIAL_TEMPLATE_KEYS = EMAIL_PARTIAL_NAMES.map((name) => `partial_${name}`);

export interface EmailRenderResources {
  partials: Record<string, string>;
  layoutHtml: string;
}

export interface EmailRenderBundle extends EmailRenderResources {
  templates: Map<string, ResolvedEmailTemplate>;
}

export function emailPartialsFromResolutions(
  resolutions: ReadonlyMap<string, EmailTemplateResolution>,
): Record<string, string> {
  return Object.fromEntries(
    EMAIL_PARTIAL_NAMES.flatMap((name, index) => {
      const resolution = resolutions.get(EMAIL_PARTIAL_TEMPLATE_KEYS[index]);
      return resolution?.ok ? [[name, resolution.template.content]] : [];
    }),
  );
}

export async function loadEmailPartials(db: DatabaseLike): Promise<Record<string, string>> {
  return emailPartialsFromResolutions(await resolveTemplateSet(db, EMAIL_PARTIAL_TEMPLATE_KEYS));
}

export async function loadEmailLayout(db: DatabaseLike): Promise<string> {
  const tmpl = await resolveTemplate(db, EMAIL_LAYOUT_TEMPLATE_KEY);
  return tmpl.content;
}

export async function loadEmailRenderResources(db: DatabaseLike): Promise<EmailRenderResources> {
  const { partials, layoutHtml } = await loadEmailRenderBundle(db);
  return { partials, layoutHtml };
}

export async function loadEmailRenderBundle(
  db: DatabaseLike,
  templateKeys: readonly string[] = [],
): Promise<EmailRenderBundle> {
  const requiredTemplateKeys = [EMAIL_LAYOUT_TEMPLATE_KEY, ...templateKeys];
  const resolutions = await resolveTemplateSet(db, [
    EMAIL_LAYOUT_TEMPLATE_KEY,
    ...EMAIL_PARTIAL_TEMPLATE_KEYS,
    ...templateKeys,
  ]);
  const templates = requireResolvedTemplates(resolutions, requiredTemplateKeys);
  return {
    layoutHtml: templates.get(EMAIL_LAYOUT_TEMPLATE_KEY)!.content,
    partials: emailPartialsFromResolutions(resolutions),
    templates,
  };
}
