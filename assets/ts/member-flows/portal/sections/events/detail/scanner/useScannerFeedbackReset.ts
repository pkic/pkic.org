import { useEffect, useRef } from "preact/hooks";
import type { EventScanResponse } from "../../../../../../../shared/schemas/event-participation-scanning";
/** Every displayed result has a finite lifetime, including malformed badges and late receipts. */
export function useScannerFeedbackReset(
  enabled: boolean,
  result: EventScanResponse | null,
  durationMs: number,
  reset: () => void,
  failed = false,
) {
  const latest = useRef(reset);
  latest.current = reset;
  const hasResult = !!result;
  useEffect(() => {
    if (!enabled || (!hasResult && !failed)) return;
    const timer = window.setTimeout(() => latest.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [enabled, hasResult, result?.operationId, result?.outcome, durationMs, failed]);
}
