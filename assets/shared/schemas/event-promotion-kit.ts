import { databaseIdSchema } from "./identifiers";
import { timeZoneSchema } from "./event-series";
import { z } from "zod";
import { promotionCopySchema } from "./event-promotion-copy";
import { agendaOccurrenceFieldsSchema, agendaPlannedMediaSchema, agendaOccurrenceQuerySchema } from "./event-agenda";
export { promotionCopySchema } from "./event-promotion-copy";
import { promotionCompositionSchema } from "./event-promotion-design";
export const PROMOTION_TEMPLATE_VERSION = 10 as const;
export const promotionRenderStateSchema = z.enum(["queued", "rendering", "retrying", "rendered", "failed", "obsolete"]);
export const promotionFormatSchema = z.enum(["landscape", "square", "portrait", "carousel"]);
export const promotionFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const promotionFormatsSchema = z
  .array(promotionFormatSchema)
  .min(1)
  .max(promotionFormatSchema.options.length)
  .refine((items) => new Set(items).size === items.length, "Choose each format once.")
  .default([...promotionFormatSchema.options]);
export const PROMOTION_RENDER_ORDER = ["portrait", "carousel", "landscape", "square"] as const;
export const promotionRenderRequestSchema = z.strictObject({
  fingerprint: promotionFingerprintSchema,
  publishedRevision: z.number().int().positive(),
  compositionRevision: z.number().int().nonnegative(),
  formats: promotionFormatsSchema,
});
export const promotionKitSaveSchema = z.object({
  expectedRevision: z.number().int().min(0),
  copy: promotionCopySchema,
});
export const promotionKitSchema = z.object({
  occurrenceId: z.string().nullable(),
  source: agendaOccurrenceFieldsSchema
    .pick({ title: true, description: true })
    .extend({
      media: agendaPlannedMediaSchema.extend({ inherited: z.boolean(), recordingAvailable: z.boolean() }).optional(),
    })
    .optional(),
  audience: z.enum(["speaker", "attendee"]).default("speaker"),
  composition: promotionCompositionSchema.optional(),
  compositionRevision: z.number().int().nonnegative().default(0),
  fingerprint: promotionFingerprintSchema.optional(),
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
    clicks: z.number().int().nonnegative(),
    confirmedRegistrations: z.number().int().nonnegative(),
    sessionRsvps: z.number().int().nonnegative(),
  }),
});
export const promotionParticipantQuerySchema = z.object({ userId: databaseIdSchema.optional() });
export const promotionArtifactQuerySchema = promotionParticipantQuerySchema.extend({
  download: z.enum(["true", "false"]).default("true"),
  representation: z.enum(["file", "artwork"]).default("file"),
  pages: z.enum(["cover", "all"]).default("cover"),
  format: promotionFormatSchema,
  revision: z.coerce.number().int().positive(),
  fingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type PromotionCopy = z.infer<typeof promotionCopySchema>;

export const promotionSessionsQuerySchema = agendaOccurrenceQuerySchema
  .omit({ accessPolicy: true, speakerUserId: true, publicationStatus: true, track: true, conflict: true })
  .extend({ ...promotionParticipantQuerySchema.shape, timeZone: timeZoneSchema.optional() })
  .superRefine((query, ctx) => {
    if (query.day && !query.timeZone)
      ctx.addIssue({ code: "custom", path: ["timeZone"], message: "Include the event time zone when choosing a day." });
  });

/** SVG pages are isolated images in the browser, never inserted as live markup. */
export const promotionArtworkSchema = z.object({
  fingerprint: promotionFingerprintSchema,
  format: promotionFormatSchema,
  pages: z
    .array(z.object({ width: z.number().int().positive(), height: z.number().int().positive(), svg: z.string() }))
    .min(1)
    .max(128),
  fontFiles: z.array(z.string()).max(6),
});

export const promotionPdfExportSchema = promotionRenderRequestSchema.omit({ formats: true });
