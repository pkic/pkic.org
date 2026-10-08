import { z } from "zod";
import { utcInstantSchema } from "./api-common";

export const scannerDeviceBacklogSchema = z.enum(["unknown", "pending", "complete"]);
const count = z.number().int().nonnegative();
/** Transport closure is event-wide; it does not establish complete attendance or presence duration. */
export const scannerReconciliationSchema = z
  .object({
    scope: z.literal("event"),
    coverage: z.enum(["from_event_creation", "legacy_unknown"]),
    coverageStartedAt: utcInstantSchema.nullable(),
    sourceState: z.enum(["live", "retention_in_progress", "purged"]),
    knownEpochs: count,
    openEpochs: count,
    closingEpochs: count,
    closedEpochs: count,
    unknownHighWaterEpochs: count,
    missingDeclaredReceipts: count,
    unprovenClosedEpochs: count,
    untrackedAttempts: count,
    unclosedGrants: count,
    deviceBacklog: scannerDeviceBacklogSchema,
  })
  .strict();
export type ScannerReconciliation = z.infer<typeof scannerReconciliationSchema>;
