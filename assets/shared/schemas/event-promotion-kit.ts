import { z } from "zod";
import { promotionCopySchema } from "./event-promotion-copy";
import { agendaOccurrenceFieldsSchema } from "./event-agenda";
export { promotionCopySchema } from "./event-promotion-copy";
import { promotionCompositionSchema } from "./event-promotion-design";
export const PROMOTION_TEMPLATE_VERSION = 3 as const;
export const promotionRenderStateSchema = z.enum(["queued", "rendering", "retrying", "rendered", "failed", "obsolete"]);
export const promotionFormatSchema = z.enum(["landscape", "square", "portrait", "panel", "carousel"]);
export const promotionKitSaveSchema = z.object({
  expectedRevision: z.number().int().min(0),
  copy: promotionCopySchema,
});
export const promotionKitSchema = z.object({
  occurrenceId: z.string().nullable(),
  source: agendaOccurrenceFieldsSchema.pick({ title: true, description: true }).optional(),
  audience: z.enum(["speaker", "attendee"]).default("speaker"),
  composition: promotionCompositionSchema.optional(),
  compositionRevision: z.number().int().nonnegative().default(0),
  fingerprint: z.string().optional(),
  publishedRevision: z.number().int(),
  templateVersion: z.literal(PROMOTION_TEMPLATE_VERSION),
  copy: promotionCopySchema.extend({ whyAttend: z.string().max(20000) }),
  formats: z.array(promotionFormatSchema),
  registrationUrl: z.string().url(),
  /** Present only when the site renders this session's page. */
  sessionUrl: z.string().url().optional(),
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
  fingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type PromotionCopy = z.infer<typeof promotionCopySchema>;
