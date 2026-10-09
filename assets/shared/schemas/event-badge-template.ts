import { z } from "zod";
import {
  badgeTemplateCss,
  parseBadgeTemplateMarkup,
  validateBadgeTemplateAsset,
  validateBadgeTemplateSvg,
} from "../badge-template-policy";
import { sponsorshipTierNameSchema } from "./sponsorship";
import { databaseIdSchema } from "./identifiers";

export const BADGE_TEMPLATE_MAX_BYTES = 768 * 1024;
export const BADGE_TEMPLATE_SETTINGS_MAX_BYTES = 1024 * 1024;
export const BADGE_TEMPLATE_SPONSOR_LOGO_MAX_BYTES = 1024 * 1024;
export const BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_BYTES = 4 * 1024 * 1024;
export const BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT = 40;
export const BADGE_TEMPLATE_SPONSOR_GROUPS_MAX_COUNT = 8;
export const badgePrintDesignSchema = z.enum(["event_badge", "name_qr"]);
export type BadgePrintDesign = z.infer<typeof badgePrintDesignSchema>;
export const badgeTemplateKeySchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const badgeTemplateAssetSchema = z
  .object({
    mime: z.enum(["image/svg+xml", "font/woff2", "font/ttf"]),
    base64: z
      .string()
      .min(4)
      .max(400000)
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .strict();
/**
 * Where a badge sponsor group's logos come from: `consortium` selects the current PKI Consortium sponsors of a
 * consortium tier (the public sponsor wall's rule), `event` selects this event's own active sponsors of an event
 * tier. Templates saved before sources existed omit it and keep their event-tier meaning.
 */
export const badgeSponsorSourceSchema = z.enum(["consortium", "event"]);
export type BadgeSponsorSource = z.infer<typeof badgeSponsorSourceSchema>;
export function badgeSponsorGroupSource(group: { source?: BadgeSponsorSource }): BadgeSponsorSource {
  return group.source ?? "event";
}
/** `label` is the printed heading for the tier's logos; without it the badge prints the tier name. */
export const badgeTemplateSponsorGroupSchema = z
  .object({
    key: badgeTemplateKeySchema,
    source: badgeSponsorSourceSchema.optional(),
    tierName: sponsorshipTierNameSchema,
    label: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

/** Private, event-owned authoring data. It contains artwork and display slots, never credentials or attendees. */
export const eventBadgeTemplateSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(160),
    widthMm: z.number().finite().min(20).max(300),
    heightMm: z.number().finite().min(20).max(300),
    frontHtml: z.string().min(1).max(32768),
    backHtml: z.string().max(32768),
    css: z.string().max(65536),
    assets: z.record(badgeTemplateKeySchema, badgeTemplateAssetSchema),
    sponsorGroups: z.array(badgeTemplateSponsorGroupSchema).max(8),
  })
  .strict()
  .superRefine((template, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(template)).byteLength > BADGE_TEMPLATE_MAX_BYTES)
      ctx.addIssue({ code: "custom", message: "The complete template must fit within 768 KiB." });
    if (Object.keys(template.assets).length > 40)
      ctx.addIssue({ code: "custom", path: ["assets"], message: "Use at most 40 shared artwork and font assets." });
    const groupKeys = new Set(template.sponsorGroups.map((group) => group.key));
    if (groupKeys.size !== template.sponsorGroups.length)
      ctx.addIssue({ code: "custom", path: ["sponsorGroups"], message: "Sponsor group keys must be unique." });
    try {
      const keys = new Set(Object.keys(template.assets));
      const artworkKeys = new Set(
        Object.entries(template.assets)
          .filter(([, asset]) => asset.mime === "image/svg+xml")
          .map(([key]) => key),
      );
      parseBadgeTemplateMarkup(template.frontHtml, artworkKeys, groupKeys);
      parseBadgeTemplateMarkup(template.backHtml, artworkKeys, groupKeys);
      if ((template.frontHtml.match(/{{qr(?:Image)?}}/g) ?? []).length !== 1)
        throw new Error("The front needs exactly one QR slot.");
      badgeTemplateCss(template.css, new Map([...keys].map((key) => [key, "asset-placeholder"])));
      for (const asset of Object.values(template.assets)) validateBadgeTemplateAsset(asset.mime, asset.base64);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid badge template." });
    }
  });
export type EventBadgeTemplate = z.infer<typeof eventBadgeTemplateSchema>;

export const badgeTemplateSponsorLogoSchema = z
  .object({
    id: databaseIdSchema,
    name: z.string().min(1).max(200),
    svg: z.string().min(1).max(BADGE_TEMPLATE_SPONSOR_LOGO_MAX_BYTES),
  })
  .strict()
  .superRefine((logo, ctx) => {
    try {
      if (new TextEncoder().encode(logo.svg).byteLength > BADGE_TEMPLATE_SPONSOR_LOGO_MAX_BYTES)
        throw new Error("Sponsor SVG must fit within 1 MiB.");
      validateBadgeTemplateSvg(logo.svg);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        path: ["svg"],
        message: error instanceof Error ? error.message : "Invalid sponsor SVG.",
      });
    }
  });
export const badgeTemplateBrandingSchema = z
  .array(
    badgeTemplateSponsorGroupSchema
      .extend({ sponsors: z.array(badgeTemplateSponsorLogoSchema).max(BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT) })
      .strict(),
  )
  .max(BADGE_TEMPLATE_SPONSOR_GROUPS_MAX_COUNT)
  .superRefine((groups, ctx) => {
    if (
      new Set(groups.map((group) => group.key)).size !== groups.length ||
      groups.some((group) => new Set(group.sponsors.map((sponsor) => sponsor.id)).size !== group.sponsors.length) ||
      groups.reduce((sum, group) => sum + group.sponsors.length, 0) > BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_COUNT ||
      groups.reduce(
        (sum, group) =>
          sum + group.sponsors.reduce((bytes, sponsor) => bytes + new TextEncoder().encode(sponsor.svg).byteLength, 0),
        0,
      ) > BADGE_TEMPLATE_SPONSOR_LOGOS_MAX_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "Use distinct groups and sponsor IDs, and at most 40 approved sponsor logos within 4 MiB.",
      });
  });
export type BadgeTemplateSponsorGroup = z.infer<typeof badgeTemplateBrandingSchema>[number];
