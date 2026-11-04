import { z } from "zod";
import { BADGE_GENERIC_BRAND_ASSETS } from "./badge-generic-template-assets";
import { BADGE_DEFAULT_FONT_ASSETS } from "./badge-default-template-fonts";
import { createPqcConferenceBadgeTemplate, PQC_CONFERENCE_BADGE_LINKS } from "./badge-pqc-template";
import { formatDateRange } from "./format-date";
import {
  badgeTemplateCustomTextSchema,
  eventBadgeTemplateSchema,
  type EventBadgeTemplate,
} from "./schemas/event-badge-template";
import { eventResourceCoreSchema } from "./schemas/event-management";
import { utcInstantSchema } from "./schemas/api-common";
import { timeZoneSchema } from "./schemas/event-series";

export const GENERIC_BADGE_LAYOUT_VERSION = "pqc-without-cityscape-v2";
export const genericBadgeTemplateInputSchema = z
  .object({
    eventName: eventResourceCoreSchema.shape.name,
    customTextOverlay: badgeTemplateCustomTextSchema.optional(),
    sponsorGroups: eventBadgeTemplateSchema.shape.sponsorGroups,
    startsAt: utcInstantSchema.nullable().optional(),
    endsAt: utcInstantSchema.nullable().optional(),
    timezone: timeZoneSchema.default("UTC"),
    city: z.string().nullable().optional(),
  })
  .strict();
export type GenericBadgeTemplateInput = z.input<typeof genericBadgeTemplateInputSchema>;

/** The production PQC design is the event default, without Amsterdam-specific artwork. */
export function createGenericBadgeTemplate(input: GenericBadgeTemplateInput): EventBadgeTemplate {
  const parsed = genericBadgeTemplateInputSchema.parse(input);
  const template = createPqcConferenceBadgeTemplate({
    title: parsed.eventName,
    dates: parsed.startsAt ? formatDateRange(parsed.startsAt, parsed.endsAt, parsed.timezone) : "",
    city: parsed.city ?? "",
    cityscape: false,
    customTextOverlay: parsed.customTextOverlay,
    sponsorGroups: parsed.sponsorGroups.map(({ source, tierName, label }) => ({
      source: source ?? "event",
      tierName,
      ...(label ? { label } : {}),
    })),
    fonts: {
      roboto_latin: BADGE_GENERIC_BRAND_ASSETS.roboto_latin,
      roboto_latin_ext: BADGE_GENERIC_BRAND_ASSETS.roboto_latin_ext,
      ...BADGE_DEFAULT_FONT_ASSETS,
    },
    links: { ...PQC_CONFERENCE_BADGE_LINKS },
  });
  // Keep caller-owned sponsor slot keys stable when reusing the shared design.
  const keys = new Map(template.sponsorGroups.map((group, index) => [group.key, parsed.sponsorGroups[index].key]));
  const remap = (html: string) =>
    html.replace(/\{\{sponsors:([^}]+)\}\}/g, (slot, key: string) =>
      keys.has(key) ? `{{sponsors:${keys.get(key)}}}` : slot,
    );
  const frontHtml = remap(template.frontHtml),
    backHtml = remap(template.backHtml);
  return { ...template, name: "PKI Consortium event badge", frontHtml, backHtml, sponsorGroups: parsed.sponsorGroups };
}
