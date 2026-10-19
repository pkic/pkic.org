import type {
  EventScanResponse,
  EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
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
  eligible: "Registered",
  warning: "Known badge · not registered",
  denied: "Badge not valid",
  unknown: "Unknown badge",
  unverified: "Verification required",
};

/** Local eligibility remains provisional until an immutable server receipt arrives. */
export function localScanResponse(
  operationId: string,
  local: Pick<EventScanResponse, "outcome" | "reason">,
): EventScanResponse {
  return { operationId, outcome: local.outcome, reason: local.reason, recorded: false, attendanceRecorded: false };
}

export function admissionDecisionLabel(decision: EventScanResponse["admissionDecision"]): string {
  return decision === "allowed"
    ? "Allowed"
    : decision === "refused"
      ? "Refused"
      : decision === "unresolved"
        ? "Unresolved"
        : "Not recorded";
}

/** A saved admission decision is independent of eligibility and observed attendance. */
export function scanFeedbackOutcome(
  result: EventScanResponse | null,
  action: EventScanRequest["action"],
): EventScanResponse["outcome"] {
  if (result?.admissionRecorded && result.admissionDecision) {
    return result.admissionDecision === "allowed"
      ? "eligible"
      : result.admissionDecision === "refused"
        ? "denied"
        : "unverified";
  }
  if (result && (action === "admission" || action === "exception")) return "unverified";
  return result?.outcome ?? "unverified";
}

export function scanEligibilityLabel(result: EventScanResponse): string {
  if (result.reason === "consent_required") return "Consent required";
  if (result.outcome === "warning") {
    if (result.reason === "wrong_location") return "Known badge · location notice";
    if (result.reason === "wrong_attendance_mode") return "Known badge · attendance notice";
    return result.reason === "missing_registration" ? "Known badge · not registered" : "Known badge · notice";
  }
  return scanOutcomeLabels[result.outcome];
}

/** Registration feedback is shared by manual and fullscreen scanning. */
export function scanFeedbackLabel(result: EventScanResponse | null, action: EventScanRequest["action"]): string {
  if (!result) return "Ready to scan";
  if (result.admissionRecorded && result.admissionDecision) {
    const decision = `Admission ${admissionDecisionLabel(result.admissionDecision).toLowerCase()}`;
    return result.attendanceRecorded ? `${decision} · attendance recorded` : decision;
  }
  if (action === "admission" || action === "exception")
    return result.recorded ? "Admission decision not recorded" : "Admission decision pending";
  if (result.outcome === "eligible") {
    if (action === "lead") return "Lead captured";
    if (action === "checkout") return result.checkoutRecorded ? "Checkout recorded" : "Checkout saved on device";
    if (result.attendanceRecorded) return "Registered · attendance recorded";
    if (!result.recorded && action !== "check") return "Registered · scan saved on device";
    return "Registered";
  }
  if (result.outcome === "denied" && action === "checkout") return "Checkout not recorded";
  if (result.outcome === "unverified") return "Verification pending";
  return scanEligibilityLabel(result);
}
