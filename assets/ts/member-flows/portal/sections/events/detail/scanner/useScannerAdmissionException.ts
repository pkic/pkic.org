import { useRef, type MutableRef } from "preact/hooks";
import type {
  EventScanRequest,
  EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import type { LocalEligibility } from "./eligibility-manifest";
import { scannerExceptionRequest } from "./ScannerExceptionReview";

/** Keep an exception tied to the exact denied badge that the operator reviewed. */
export function useScannerAdmissionException({
  allowed,
  action,
  result,
  captureAllowed,
  persistCapture,
  scanSaved,
  lastOperation,
  presentSavedEligibility,
  verifyQueuedScan,
  setBusy,
}: {
  allowed: boolean;
  action: EventScanRequest["action"];
  result: EventScanResponse | null;
  captureAllowed: () => boolean;
  persistCapture: (scan: EventScanRequest) => Promise<{ scan: EventScanRequest; local?: LocalEligibility }>;
  scanSaved: () => Promise<void>;
  lastOperation: MutableRef<string | null>;
  presentSavedEligibility: (
    saved: { scan: EventScanRequest; local?: LocalEligibility },
    verifyQueuedScan: (operationId: string) => Promise<boolean>,
  ) => Promise<boolean>;
  verifyQueuedScan: (operationId: string) => Promise<boolean>;
  setBusy: (busy: boolean) => void;
}) {
  const lastCapture = useRef<EventScanRequest | null>(null);
  const exception = useRef<{ sourceOperation: string; request: EventScanRequest } | null>(null);
  function clear() {
    lastCapture.current = null;
    exception.current = null;
  }
  function remember(scan: EventScanRequest) {
    lastCapture.current = scan;
    exception.current = null;
  }
  function currentRequest(): EventScanRequest | null {
    const source = lastCapture.current;
    if (
      !allowed ||
      action === "lead" ||
      !result ||
      result.outcome === "eligible" ||
      result.outcome === "unknown" ||
      !source ||
      source.operationId !== result.operationId
    )
      return null;
    if (exception.current?.sourceOperation === result.operationId) return exception.current.request;
    const request = scannerExceptionRequest(
      {
        operatorUserId: source.operatorUserId,
        deviceId: source.deviceId,
        targetId: source.occurrenceId,
        roomId: source.roomId ?? null,
      },
      source.badgeId,
    );
    if (request) exception.current = { sourceOperation: result.operationId, request };
    return request;
  }
  const request = currentRequest();
  async function confirm(submitted: EventScanRequest): Promise<void> {
    if (
      !captureAllowed() ||
      submitted.action !== "exception" ||
      submitted.operationId !== currentRequest()?.operationId
    )
      throw new Error("This admission exception is no longer available.");
    setBusy(true);
    try {
      const saved = await persistCapture(submitted);
      lastOperation.current = submitted.operationId;
      await scanSaved();
      clear();
      await presentSavedEligibility(saved, verifyQueuedScan);
    } finally {
      setBusy(false);
    }
  }
  return { request, confirm, remember, clear };
}
