import { z } from "zod";
import { utcInstantSchema } from "./api-common";
import { promotionFormatsSchema } from "./event-promotion-kit";
export const promotionBatchCreateSchema = z.strictObject({
  requestId: z.uuid(),
  publishedRevision: z.number().int().positive(),
  formats: promotionFormatsSchema,
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
