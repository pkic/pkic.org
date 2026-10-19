import { describe, expect, it } from "vitest";
import { boundedScannedValue, scannedAttemptCaptureSchema } from "../../assets/shared/schemas/scanner-attempt-capture";
import { scannerFailureRequestSchema } from "../../assets/shared/schemas/event-scanner-failure";
describe("bounded original scan capture", () => {
  it("preserves the first64Unicodecodepoints and whitespace without splitting a character", () => {
    const raw = " \n" + "😀".repeat(64) + "tail";
    const evidence = boundedScannedValue(raw);
    expect(evidence.scannedValue).toBe(" \n" + "😀".repeat(62));
    expect(evidence.scannedValueTruncated).toBe(true);
    expect(scannedAttemptCaptureSchema.safeParse(evidence).success).toBe(true);
    expect(boundedScannedValue("😀".repeat(64))).toEqual({
      scannedValue: "😀".repeat(64),
      scannedValueTruncated: false,
    });
    expect(
      scannedAttemptCaptureSchema.safeParse({ scannedValue: "😀".repeat(65), scannedValueTruncated: true }).success,
    ).toBe(false);
  });
  it("does not let a refusal carry a badge identity or profile assertion", () => {
    const body = {
      operationId: crypto.randomUUID(),
      operatorUserId: crypto.randomUUID(),
      deviceId: crypto.randomUUID(),
      scannerSession: { epochId: crypto.randomUUID(), sequence: 1 },
      occurrenceId: null,
      action: "attendance",
      observedAt: new Date().toISOString(),
      reason: "malformed_credential",
      ...boundedScannedValue("bad"),
    };
    expect(scannerFailureRequestSchema.safeParse(body).success).toBe(true);
    for (const extra of [{ badgeId: "secret" }, { name: "Private person" }, { attendanceRecorded: true }])
      expect(scannerFailureRequestSchema.safeParse({ ...body, ...extra }).success).toBe(false);
  });
});
