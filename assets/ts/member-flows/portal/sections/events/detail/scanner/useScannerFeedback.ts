import { useRef, useState, type MutableRef } from "preact/hooks";
import type {
  EventScanResponse,
  EventScanRequest,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import type { LocalEligibility } from "./eligibility-manifest";
import { receiptMatchesOperation, localScanResponse } from "./scan-stream";
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
  function setResult(value: EventScanResponse | null) {
    setFailed(false);
    updateResult(value);
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
    if (collector || authorityPaused.current || !receiptMatchesOperation(receipt.operationId, lastOperation.current))
      return;
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
  return {
    result,
    setResult,
    message,
    setMessage,
    showProvisionalMessage,
    presentReceipt,
    showLocalEligibility,
    failure,
  };
}
