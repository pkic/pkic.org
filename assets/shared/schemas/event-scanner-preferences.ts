import { z } from "zod";

export const scannerFeedbackPauses = [0, 300, 600, 1000, 1500, 2000, 3000, 5000, 10000] as const;
export const scannerPreferencesSchema = z
  .object({
    version: z.literal(2).default(2),
    sound: z.boolean().default(true),
    feedbackPause: z.union(scannerFeedbackPauses.map((duration) => z.literal(duration))).default(1000),
  })
  .strict();

/** Version-less records cannot distinguish the old default from an explicit 0.3-second choice.
 * Both move to one second; versioned records preserve every explicitly saved choice. */
export const storedScannerPreferencesSchema = z.union([
  scannerPreferencesSchema.extend({ version: z.literal(2) }),
  scannerPreferencesSchema.omit({ version: true }).transform((previous) =>
    scannerPreferencesSchema.parse({
      ...previous,
      feedbackPause: previous.feedbackPause === 300 ? 1000 : previous.feedbackPause,
    }),
  ),
]);
