import { useEffect, useRef } from "preact/hooks";
import type { EventScanResponse } from "../../../../../../../shared/schemas/event-participation-scanning";
/** Successful scans resume automatically; results requiring operator attention stay visible. */
export function useScannerFeedbackReset(
  enabled: boolean,
  result: EventScanResponse | null,
  durationMs: number,
  reset: () => void,
  needsAdvance = false,
) {
  const latest = useRef(reset);
  latest.current = reset;
  const hasResult = !!result;
  useEffect(() => {
    if (!enabled || !hasResult || needsAdvance) return;
    // Reset only the feedback that armed this timer, even before the next effect cleanup.
    const timer = window.setTimeout(latest.current, durationMs);
    return () => window.clearTimeout(timer);
  }, [enabled, hasResult, result?.operationId, result?.outcome, durationMs, needsAdvance]);
}
