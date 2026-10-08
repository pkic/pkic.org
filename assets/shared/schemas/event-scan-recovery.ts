import { z } from "zod";
import { offlineScanRecordSchema, eventScanResponseSchema } from "./event-participation-scanning";
import { scannerRecoveryEpochSchema, SCANNER_RECOVERY_EPOCH_LIMIT } from "./event-scanner-devices";
export const archivedScanSchema = offlineScanRecordSchema
  .extend({
    receipt: eventScanResponseSchema,
    acknowledgedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.receipt.operationId !== value.scan.operationId)
      context.addIssue({ code: "custom", message: "Receipt belongs to a different scan." });
    if (
      value.scan.scannerSession &&
      (!value.receipt.scannerReceipt ||
        value.receipt.scannerReceipt.epochId !== value.scan.scannerSession.epochId ||
        value.receipt.scannerReceipt.sequence !== value.scan.scannerSession.sequence ||
        value.receipt.scannerReceipt.operationId !== value.scan.operationId)
    )
      context.addIssue({ code: "custom", message: "Receipt belongs to a different scanner epoch or sequence." });
    if (value.expiresAt - value.acknowledgedAt !== 14 * 24 * 60 * 60 * 1000)
      context.addIssue({ code: "custom", message: "History retention is 14 days." });
  });
export type ArchivedScan = z.infer<typeof archivedScanSchema>;
export const scanRecoverySchema = z
  .object({
    version: z.literal(1),
    operatorUserId: z.string().uuid(),
    eventId: z.string(),
    exportedAt: z.string().datetime(),
    records: archivedScanSchema.array().max(100000),
    pending: offlineScanRecordSchema.array().max(100000),
    scannerEpochs: scannerRecoveryEpochSchema.array().max(SCANNER_RECOVERY_EPOCH_LIMIT).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    for (const record of [...value.records, ...value.pending]) {
      if (record.eventId !== value.eventId || record.scan.operatorUserId !== value.operatorUserId)
        context.addIssue({ code: "custom", message: "Recovery scans must belong to this operator and event." });
    }
    const epochs = new Set<string>();
    for (const epoch of value.scannerEpochs) {
      if (epoch.eventId !== value.eventId || epoch.operatorUserId !== value.operatorUserId || epochs.has(epoch.epochId))
        context.addIssue({
          code: "custom",
          message: "Recovery scanner epochs must uniquely belong to this operator and event.",
        });
      epochs.add(epoch.epochId);
    }
    if (value.records.length + value.pending.length > 100000)
      context.addIssue({ code: "custom", message: "Recovery files contain at most 100,000 scans." });
  });
