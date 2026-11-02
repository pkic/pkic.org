import { z } from "zod";
import {
  eventBadgeTemplateSchema,
  badgeTemplateAssetSchema,
  badgeTemplateSponsorGroupSchema,
} from "./event-badge-template";
import { validateBadgeTemplateAsset } from "../badge-template-policy";

export const promotionPanelSchema = z.enum([
  "cover",
  "speakers",
  "content",
  "details",
  "picks",
  "register",
  "sponsors",
]);
export const promotionCompositionSchema = z.strictObject({
  panels: z
    .array(promotionPanelSchema)
    .min(1)
    .max(7)
    .refine((items) => new Set(items).size === items.length, "Choose each panel once."),
  content: z.enum(["auto", "takeaways", "abstract"]).default("auto"),
  overlap: z.enum(["subtle", "bold"]).default("subtle"),
  stillLayout: z.enum(["compact", "expanded"]).default("compact"),
  motif: z.boolean().default(true),
  qrCode: z.boolean().default(false),
  summary: z.string().trim().max(800).default(""),
  takeaways: z.array(z.string().trim().min(5).max(180)).max(8).default([]),
  callToAction: z.string().trim().min(5).max(100).default("Register for this event"),
  sessionIds: z.array(z.string().min(1)).max(12).default([]),
});
export const promotionCompositionSaveSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  composition: promotionCompositionSchema,
});
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
/** Event-owned display policy; artwork uses the same validated asset contract as badges. */
export const eventPromotionDesignSchema = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(160),
    colors: z.array(color).min(2).max(5),
    assets: z
      .object({
        logo: badgeTemplateAssetSchema.optional(),
        mark: badgeTemplateAssetSchema.optional(),
        motif: badgeTemplateAssetSchema.optional(),
        texture: badgeTemplateAssetSchema.optional(),
      })
      .default({}),
    sponsorGroups: z.array(badgeTemplateSponsorGroupSchema).max(8).default([]),
    sponsorSource: z.enum(["event", "selected"]).default("event"),
    panels: promotionCompositionSchema.shape.panels,
    /** A plan to capture media never grants permission to advertise it. */
    advertiseLiveStreaming: z.boolean().default(false),
    advertiseRecordings: z.boolean().default(false),
  })
  .strict()
  .superRefine((design, ctx) => {
    if (new TextEncoder().encode(JSON.stringify(design)).byteLength > 768 * 1024)
      ctx.addIssue({ code: "custom", message: "The complete promotion design must fit within 768 KiB." });
    for (const [key, asset] of Object.entries(design.assets)) {
      if (!asset) continue;
      try {
        if (asset.mime !== "image/svg+xml") throw new Error("Use SVG artwork.");
        validateBadgeTemplateAsset(asset.mime, asset.base64);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          path: ["assets", key],
          message: error instanceof Error ? error.message : "Invalid artwork.",
        });
      }
    }
  });
export type PromotionComposition = z.infer<typeof promotionCompositionSchema>;
export type EventPromotionDesign = z.infer<typeof eventPromotionDesignSchema>;
export const DEFAULT_PROMOTION_COLORS = ["#0b2a1c", "#125c3c", "#20506e", "#b0581f"] as const;
export const DEFAULT_PROMOTION_PANELS = ["cover", "speakers", "content", "details", "register", "sponsors"] as const;
export function defaultPromotionComposition(attendee = false): PromotionComposition {
  return promotionCompositionSchema.parse({
    panels: attendee ? ["cover", "picks", "register", "sponsors"] : [...DEFAULT_PROMOTION_PANELS],
  });
}

/** Event artwork follows the same selected badge design until a promotion design is saved. */
export function defaultEventPromotionDesign(
  name: string,
  badge?: z.infer<typeof eventBadgeTemplateSchema> | null,
): EventPromotionDesign {
  return eventPromotionDesignSchema.parse({
    version: 1,
    name: badge?.name ?? name,
    colors: [...DEFAULT_PROMOTION_COLORS],
    assets: {
      logo: badge?.assets.logo_white,
      mark: badge?.assets.mark,
      motif: badge?.assets.canal_houses,
      texture: badge?.assets.dot_grid,
    },
    sponsorGroups: badge?.sponsorGroups ?? [],
    panels: [...DEFAULT_PROMOTION_PANELS],
  });
}

/** One artwork fallback for exports, social previews, and email attachments. */
export function eventPromotionDesignFromSettings(
  name: string,
  settings: Record<string, unknown>,
): EventPromotionDesign {
  const badge = eventBadgeTemplateSchema
    .nullable()
    .parse(settings.promotionDesign ? null : (settings.badgeTemplate ?? null));
  return eventPromotionDesignSchema.parse(settings.promotionDesign ?? defaultEventPromotionDesign(name, badge));
}
