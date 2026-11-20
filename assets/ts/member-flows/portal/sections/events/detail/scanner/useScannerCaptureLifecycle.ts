import { useEffect, useRef } from "preact/hooks";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { scannerCaptureActive } from "./scanner-offline-context";

/** Keep an active capture usable through auth loss and open a saved task directly. */
export function useScannerCaptureLifecycle({
  fastMode,
  collectorContext,
  ready,
  start,
}: {
  fastMode: boolean;
  collectorContext?: ScannerOfflineContext;
  ready: boolean;
  start: () => void;
}) {
  const started = useRef(false);
  const latestStart = useRef(start);
  latestStart.current = start;

  useEffect(() => {
    scannerCaptureActive.value = fastMode;
    return () => {
      scannerCaptureActive.value = false;
    };
  }, [fastMode]);

  useEffect(() => {
    if (!collectorContext || !ready || started.current) return;
    started.current = true;
    latestStart.current();
  }, [collectorContext, ready]);
}
