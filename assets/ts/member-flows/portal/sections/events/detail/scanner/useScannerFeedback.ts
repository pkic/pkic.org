import { useRef, useState, type MutableRef } from "preact/hooks";
import type {
  EventScanResponse,
  EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import type { LocalEligibility } from "./eligibility-manifest";
import { receiptMatchesOperation, localScanResponse, unverifiedSavedFeedback } from "./scan-stream";
import { useScannerFeedbackReset } from "./useScannerFeedbackReset";
export function useScannerFeedback({
  enabled,
  durationMs,
  collector,
  holdEligible = false,
  currentOperation: lastOperation,
  committedOperation: lastCommittedOperation,
  authorityPaused,
}: {
  enabled: boolean;
  durationMs: number;
  collector: boolean;
  holdEligible?: boolean;
  currentOperation: MutableRef<string | null>;
  committedOperation: MutableRef<string | null>;
  authorityPaused: MutableRef<boolean>;
}) {
  const [lastResult, setLastResult] = useState<EventScanResponse | null>(null);
  const [result, updateResult] = useState<EventScanResponse | null>(null);
  const lastDisplayedOperation = useRef<string | null>(null);
  const [message, updateMessage] = useState("Ready to scan");
  const messageOperation = useRef<string | null>(null);
  function setMessage(value: string) {
    messageOperation.current = null;
    updateMessage(value);
  }
  function showProvisionalMessage(operation: string, value: string) {
    if (lastCommittedOperation.current === operation || !receiptMatchesOperation(operation, lastOperation.current))
      return;
    messageOperation.current = operation;
    updateMessage(value);
  }
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  function setResult(value: EventScanResponse | null) {
    setChecking(null);
    setFailed(false);
    updateResult(value);
    if (value) {
      lastDisplayedOperation.current = value.operationId;
      setLastResult(value);
    }
  }
  function failure(value: string) {
    setFailed(true);
    setMessage(value);
  }
  const requiresAdvance = (value: EventScanResponse | null) =>
    Boolean(
      value &&
      (holdEligible ||
        value.outcome !== "eligible" ||
        (value.admissionRecorded && value.admissionDecision !== "allowed")),
    );
  const needsAdvance = failed || requiresAdvance(result);
  const feedbackOperation = lastOperation.current;
  useScannerFeedbackReset(
    enabled,
    result,
    durationMs,
    () => {
      if (lastOperation.current !== feedbackOperation) return;
      lastOperation.current = null;
      setResult(null);
      setMessage("Ready to scan");
    },
    needsAdvance,
  );
  function presentReceipt(receipt: EventScanResponse) {
    if (collector || authorityPaused.current) return;
    setLastResult((last) => (last?.operationId === receipt.operationId ? receipt : last));
    if (!receiptMatchesOperation(receipt.operationId, lastOperation.current)) {
      // A late refusal still needs attention if the successful local result
      // cleared and no newer badge has taken its place.
      if (
        lastOperation.current !== null ||
        lastDisplayedOperation.current !== receipt.operationId ||
        !requiresAdvance(receipt)
      )
        return;
    }
    lastCommittedOperation.current = receipt.operationId;
    setResult(receipt);
    if (messageOperation.current === receipt.operationId) setMessage("");
  }
  function showLocalEligibility(scan: EventScanRequest, local?: LocalEligibility) {
    if (!local || authorityPaused.current) return;
    if (
      lastCommittedOperation.current === scan.operationId ||
      !receiptMatchesOperation(scan.operationId, lastOperation.current)
    )
      return;
    setResult(localScanResponse(scan.operationId, local));
    showProvisionalMessage(scan.operationId, local.message);
  }
  /** A local miss is provisional; only the queued operation's server receipt can confirm failure. */
  async function presentSavedEligibility(
    saved: { scan: EventScanRequest; local?: LocalEligibility },
    verifyQueuedScan: (operationId: string) => Promise<boolean>,
  ) {
    const local =
      saved.local ??
      (holdEligible
        ? { ...unverifiedSavedFeedback, message: "The lead will be confirmed after upload." }
        : unverifiedSavedFeedback);
    if (lastCommittedOperation.current === saved.scan.operationId)
      return receiptMatchesOperation(saved.scan.operationId, lastOperation.current);
    if (!receiptMatchesOperation(saved.scan.operationId, lastOperation.current)) return false;
    if (!collector && !navigator.onLine) {
      showLocalEligibility(
        saved.scan,
        local.outcome === "unknown"
          ? {
              outcome: "unverified",
              reason: "verification_required",
              message: holdEligible
                ? "Reconnect to confirm the lead."
                : "Badge not found in saved badge data. Reconnect to verify.",
            }
          : local,
      );
      return true;
    }
    if (!collector && local.outcome !== "eligible") {
      setChecking(saved.scan.operationId);
      showProvisionalMessage(saved.scan.operationId, "Checking badge online…");
      if (!(await verifyQueuedScan(saved.scan.operationId)))
        showLocalEligibility(saved.scan, local.outcome === "unverified" ? local : unverifiedSavedFeedback);
    } else {
      showLocalEligibility(saved.scan, local);
    }
    return receiptMatchesOperation(saved.scan.operationId, lastOperation.current);
  }
  return {
    result,
    lastResult,
    clearFeedback: () => {
      lastDisplayedOperation.current = null;
      setResult(null);
      setLastResult(null);
    },
    failed,
    needsAdvance,
    captureStatus: failed
      ? { key: "capture-failure", tone: "denied" as const, title: "Scan not recorded", detail: message, record: false }
      : checking
        ? { key: checking, tone: "unverified" as const, title: "Checking badge online…", record: false }
        : undefined,
    setResult,
    message,
    setMessage,
    showProvisionalMessage,
    presentReceipt,
    presentSavedEligibility,
    failure,
  };
}
