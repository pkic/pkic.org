import { z } from "zod";

/** Keep the actual scanned prefix, before decoding or whitespace normalization. */
export const SCANNED_VALUE_LIMIT = 64;
export function boundedScannedValue(raw: string): { scannedValue: string; scannedValueTruncated: boolean } {
  const prefix: string[] = [];
  for (const point of raw) {
    if (prefix.length === SCANNED_VALUE_LIMIT) return { scannedValue: prefix.join(""), scannedValueTruncated: true };
    prefix.push(point);
  }
  return { scannedValue: prefix.join(""), scannedValueTruncated: false };
}
export const scannedAttemptCaptureSchema = z.object({
  scannedValue: z
    .string()
    .max(SCANNED_VALUE_LIMIT * 2)
    .refine((value) => [...value].length <= SCANNED_VALUE_LIMIT, "Keep at most 64 characters from the scanned value."),
  scannedValueTruncated: z.boolean(),
});
export const SCANNER_LOCAL_FAILURE_REASONS = [
  "malformed_credential",
  "unsupported_code",
  "storage_unavailable",
  "capture_failed",
  "capture_validation_failed",
] as const;
export const scannerFailureReasonSchema = z.enum(SCANNER_LOCAL_FAILURE_REASONS);
