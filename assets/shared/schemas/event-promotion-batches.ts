import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { promotionFormatSchema } from "./event-promotion-kit";
export const promotionBatchCreateSchema = z.strictObject({
  requestId: z.uuid(),
  publishedRevision: z.number().int().positive(),
  formats: z
    .array(promotionFormatSchema)
    .min(1)
    .max(5)
    .refine((items) => new Set(items).size === items.length, "Choose each format once.")
    .default([...promotionFormatSchema.options]),
});
export const promotionBatchSchema = z.object({
  id: z.uuid(),
  publishedRevision: z.number().int().positive(),
  createdAt: utcInstantSchema,
  status: z.enum(["preparing", "rendering", "complete", "needs_attention", "obsolete"]),
  totalKits: z.number().int().nonnegative(),
  readyKits: z.number().int().nonnegative(),
  failedKits: z.number().int().nonnegative(),
  pendingKits: z.number().int().nonnegative(),
});
export type PromotionBatch = z.infer<typeof promotionBatchSchema>;
