import { z } from "zod";
import { utcInstantSchema } from "./api-common";
export const PROMOTION_TEMPLATE_VERSION = 2 as const;
export const promotionRenderStateSchema = z.enum(["queued", "rendering", "retrying", "rendered", "failed", "obsolete"]);
export const promotionFormatSchema = z.enum(["landscape", "square", "portrait", "panel", "carousel"]);
export const promotionCopySchema = z.object({
  whyAttend: z.string().trim().min(20).max(800),
  takeaways: z.array(z.string().trim().min(5).max(180)).min(2).max(5),
  callToAction: z.string().trim().min(5).max(100),
  campaign: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .max(60)
    .default("speaker-kit"),
  approvedAt: utcInstantSchema.nullable(),
});
export const promotionKitSaveSchema = z.object({
  expectedRevision: z.number().int().min(0),
  copy: promotionCopySchema,
});
export const promotionKitSchema = z.object({
  occurrenceId: z.string(),
  publishedRevision: z.number().int(),
  templateVersion: z.literal(PROMOTION_TEMPLATE_VERSION),
  copy: promotionCopySchema,
  formats: z.array(promotionFormatSchema),
  registrationUrl: z.string().url(),
  sessionUrl: z.string().url(),
  stale: z.boolean(),
  artifacts: z.array(
    z.object({
      format: promotionFormatSchema,
      status: promotionRenderStateSchema,
      attempts: z.number().int().nonnegative(),
    }),
  ),
  metrics: z.object({
    downloads: z.number().int().nonnegative(),
    clicks: z.number().int().nonnegative(),
    confirmedRegistrations: z.number().int().nonnegative(),
    sessionRsvps: z.number().int().nonnegative(),
  }),
});
export const promotionArtifactQuerySchema = z.object({
  download: z.enum(["true", "false"]).default("true"),
  format: promotionFormatSchema,
  revision: z.coerce.number().int().positive(),
});
export type PromotionCopy = z.infer<typeof promotionCopySchema>;
