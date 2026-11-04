import { z } from "zod";

export const scannerFeedbackPauses = [0, 300, 600, 1000] as const;
export const scannerPreferencesSchema = z
  .object({
    sound: z.boolean().default(true),
    feedbackPause: z.union(scannerFeedbackPauses.map((duration) => z.literal(duration))).default(300),
  })
  .strict();
