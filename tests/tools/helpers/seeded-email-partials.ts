import type { EmailTemplatePartials } from "../../../assets/shared/schemas/email-templates";
import { compileSimpleTemplate } from "../../../functions/_lib/email/render";
import { DEFAULT_TEMPLATES } from "../../../scripts/seed-email-templates.mjs";

/** The seeded `partial_<name>` templates, as the renderer receives them from the database. */
export const SEEDED_EMAIL_PARTIALS: EmailTemplatePartials = Object.fromEntries(
  DEFAULT_TEMPLATES.filter((template) => template.key.startsWith("partial_")).map((template) => [
    template.key.slice("partial_".length),
    { content: template.content, contentType: template.contentType ?? "markdown" },
  ]),
);

/** Template data with the seeded partials, so `{{> greeting}}` and the other shared blocks resolve. */
export function withSeededPartials<T extends Record<string, unknown>>(
  data: T,
): T & { _partials: EmailTemplatePartials } {
  return { ...data, _partials: SEEDED_EMAIL_PARTIALS };
}

/** Compile a seeded template body the way delivery does, shared blocks included. */
export function compileSeededBody(content: string, data: Record<string, unknown>): string {
  return compileSimpleTemplate(content, withSeededPartials(data), "markdown");
}
