import { z } from "zod";

export const scannerFeedbackPauses = [0, 300, 600, 1000, 1500, 2000, 3000, 5000, 10000] as const;
export const scannerPreferencesSchema = z
  .object({
    version: z.literal(2).default(2),
    sound: z.boolean().default(true),
    feedbackPause: z.union(scannerFeedbackPauses.map((duration) => z.literal(duration))).default(1000),
  })
  .strict();

/** Upgrade the former implicit 0.3-second default while preserving explicitly saved current choices. */
export const storedScannerPreferencesSchema = z.union([
  scannerPreferencesSchema.extend({ version: z.literal(2) }),
  scannerPreferencesSchema.omit({ version: true }).transform((previous) =>
    scannerPreferencesSchema.parse({
      ...previous,
      feedbackPause: previous.feedbackPause === 300 ? 1000 : previous.feedbackPause,
    }),
  ),
]);
