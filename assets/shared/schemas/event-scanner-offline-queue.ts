import { z } from "zod";
import { offlineScanRecordSchema, enrolledEventScanRequestSchema } from "./event-participation-scanning";
import { scannerFailureRequestSchema, scannerFailureCaptureSchema } from "./event-scanner-failure";

export { scannerFailureCaptureSchema } from "./event-scanner-failure";
export type ScannerFailureCapture = z.infer<typeof scannerFailureCaptureSchema>;
const failureRecordSchema = offlineScanRecordSchema
  .omit({ scan: true })
  .extend({
    kind: z.literal("failure"),
    scan: scannerFailureRequestSchema,
  })
  .strict();
export const scannerQueueRecordSchema = z.discriminatedUnion("kind", [
  offlineScanRecordSchema.extend({ kind: z.literal("scan") }).strict(),
  failureRecordSchema,
]);
export const scannerQueueCaptureSchema = z.discriminatedUnion("kind", [
  offlineScanRecordSchema.extend({ kind: z.literal("scan") }).strict(),
  failureRecordSchema.extend({ scan: scannerFailureCaptureSchema }).strict(),
]);
export const enrolledScannerQueueRecordSchema = z.discriminatedUnion("kind", [
  offlineScanRecordSchema.extend({ kind: z.literal("scan"), scan: enrolledEventScanRequestSchema }).strict(),
  failureRecordSchema,
]);
export type ScannerQueueRecord = z.infer<typeof scannerQueueRecordSchema>;
export type ScannerQueueCapture = z.infer<typeof scannerQueueCaptureSchema>;
