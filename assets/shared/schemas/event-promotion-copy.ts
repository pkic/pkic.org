import { z } from "zod";
import { utcInstantSchema } from "./api-common";
export const promotionCopySchema = z.object({
  whyAttend: z.string().trim().min(20).max(800),
  takeaways: z.array(z.string().trim().min(5).max(180)).max(8).default([]),
  callToAction: z.string().trim().min(5).max(100),
  campaign: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]+$/)
    .max(60)
    .default("speaker-kit"),
  approvedAt: utcInstantSchema.nullable(),
});
export type PromotionCopy = z.infer<typeof promotionCopySchema>;
