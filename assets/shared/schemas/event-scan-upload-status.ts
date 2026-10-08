import { z } from "zod";

export const scanDrainResultSchema = z
  .object({
    uploaded: z.number().int().nonnegative(),
    retryAfterMs: z.number().finite().nonnegative().optional(),
    state: z.enum(["complete", "authentication_required", "retry"]),
  })
  .strict();
export const scannerUploadStatusMessageSchema = scanDrainResultSchema.extend({
  type: z.literal("pkic-scanner-upload-status"),
});
export type ScanDrainResult = z.infer<typeof scanDrainResultSchema>;
