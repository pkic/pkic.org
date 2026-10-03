import type { EventScanResponse } from "../../../../../../../shared/schemas/event-participation-scanning";
/** Suppresses repeated camera frames while allowing every different badge through immediately. */
export class ScanFrameGate {
  private readonly seen = new Map<string, number>();
  constructor(
    private readonly quietMs = 2500,
    private readonly maximum = 256,
  ) {}
  accept(credential: string, now: number): boolean {
    const previous = this.seen.get(credential);
    this.seen.delete(credential);
    this.seen.set(credential, now);
    if (this.seen.size > this.maximum) this.seen.delete(this.seen.keys().next().value!);
    return previous === undefined || now - previous >= this.quietMs;
  }
  clear(): void {
    this.seen.clear();
  }
}

/** A delayed acknowledgment can only update the badge currently being checked. */
export function receiptMatchesOperation(operationId: string, currentOperation: string | null): boolean {
  return operationId === currentOperation;
}

export function unknownScanResponse(operationId: string): EventScanResponse {
  return { operationId, outcome: "unknown", reason: "unknown_credential", recorded: false, attendanceRecorded: false };
}

export const scanOutcomeLabels = {
  eligible: "Eligible",
  warning: "Registration required",
  denied: "Admission denied",
  unknown: "Unknown badge",
  unverified: "Verification required",
};
