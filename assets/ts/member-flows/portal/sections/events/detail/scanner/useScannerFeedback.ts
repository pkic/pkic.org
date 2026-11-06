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
  currentOperation: lastOperation,
  committedOperation: lastCommittedOperation,
  authorityPaused,
}: {
  enabled: boolean;
  durationMs: number;
  collector: boolean;
  currentOperation: MutableRef<string | null>;
  committedOperation: MutableRef<string | null>;
  authorityPaused: MutableRef<boolean>;
}) {
  const [lastResult, setLastResult] = useState<EventScanResponse | null>(null);
  const [result, updateResult] = useState<EventScanResponse | null>(null);
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
    if (value) setLastResult(value);
  }
  function failure(value: string) {
    setFailed(true);
    setMessage(value);
  }
  useScannerFeedbackReset(
    enabled,
    result,
    durationMs,
    () => {
      lastOperation.current = null;
      setResult(null);
      setMessage("Ready to scan");
    },
    failed,
  );
  function presentReceipt(receipt: EventScanResponse) {
    if (collector || authorityPaused.current) return;
    setLastResult((last) => (last?.operationId === receipt.operationId ? receipt : last));
    if (!receiptMatchesOperation(receipt.operationId, lastOperation.current)) return;
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
    const local = saved.local ?? unverifiedSavedFeedback;
    if (lastCommittedOperation.current === saved.scan.operationId)
      return receiptMatchesOperation(saved.scan.operationId, lastOperation.current);
    if (!receiptMatchesOperation(saved.scan.operationId, lastOperation.current)) return false;
    if (local.outcome === "unknown" || local.outcome === "unverified") {
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
      setResult(null);
      setLastResult(null);
    },
    failed,
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
    showLocalEligibility,
    presentSavedEligibility,
    failure,
  };
}
