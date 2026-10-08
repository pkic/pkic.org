import { useEffect, useRef, useState } from "preact/hooks";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import {
  eventScanResponseSchema,
  type EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { drainScanOutbox, pendingScanCount, requestScanOutboxBackgroundSync } from "./scan-outbox";
import { scannerWorkerMessageListener } from "./scanner-worker-messages";

/** Own the page's bounded foreground drain and reconnect/worker wake-up lifecycle. */
export function useScannerOutboxSync({
  slug,
  operatorUserId,
  collectorContext,
  authorityPaused,
  currentOperation,
  presentReceipt,
  setResult,
  setMessage,
  stopCamera,
  refreshHistory,
}: {
  slug: string;
  operatorUserId: string;
  collectorContext?: ScannerOfflineContext;
  authorityPaused: { current: boolean };
  currentOperation: () => string | null;
  presentReceipt: (receipt: EventScanResponse) => void;
  setResult: (receipt: EventScanResponse | null) => void;
  setMessage: (message: string) => void;
  stopCamera: () => void;
  refreshHistory: () => Promise<void>;
}) {
  const [pending, setPending] = useState(0);
  const [pendingReadyScope, setPendingReadyScope] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const retryTimer = useRef<number | null>(null);
  const activeSyncs = useRef(0);
  const syncAgain = useRef(false);
  function cancelRetries() {
    syncAgain.current = false;
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
  }
  async function sync() {
    if (collectorContext) {
      setPending(await pendingScanCount(operatorUserId));
      setPendingReadyScope(`${slug}:${operatorUserId}`);
      setUploadStatus("Reconnect and check sign-in to verify and upload.");
      return;
    }
    if (activeSyncs.current >= 4) {
      syncAgain.current = true;
      return;
    }
    activeSyncs.current++;
    try {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      const drained = await drainScanOutbox(async (record) => {
        const response = await fetch(`/api/v1/events/${encodeURIComponent(record.eventId)}/scans`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(record.scan),
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const receipt = eventScanResponseSchema.parse(await response.clone().json());
          presentReceipt(receipt);
        }
        return response;
      }, operatorUserId);
      if (drained.state === "authentication_required") {
        authorityPaused.current = true;
        setResult(null);
        stopCamera();
        syncAgain.current = false;
      }
      if (drained.uploaded > 0) await refreshHistory();
      const remaining = await pendingScanCount(operatorUserId);
      setPending(remaining);
      setPendingReadyScope(`${slug}:${operatorUserId}`);
      if (remaining > 0 && drained.state !== "authentication_required") await requestScanOutboxBackgroundSync();
      if (drained.state === "retry" && navigator.onLine)
        retryTimer.current = window.setTimeout(() => {
          void sync();
        }, drained.retryAfterMs ?? 1000);
      if (authorityPaused.current) setMessage("Sign in again to upload pending scans.");
      setUploadStatus(
        authorityPaused.current
          ? "Sign in again to upload pending scans."
          : remaining === 0
            ? "All pending scans uploaded."
            : drained.state === "retry"
              ? "Uploads will resume when connected."
              : "Uploading scans in the background…",
      );
    } finally {
      activeSyncs.current--;
      if (syncAgain.current) {
        syncAgain.current = false;
        void sync();
      }
    }
  }
  useEffect(() => {
    setPendingReadyScope(null);
    const reconnect = () => {
      void sync();
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    const acknowledged = scannerWorkerMessageListener({
      currentOperation,
      authorityPaused: () => authorityPaused.current,
      setResult: presentReceipt,
      refreshPending: async () => setPending(await pendingScanCount(operatorUserId)),
      syncCurrentOperator: sync,
    });
    navigator.serviceWorker?.addEventListener("message", acknowledged);
    const resume = () => {
      if (document.visibilityState === "visible") reconnect();
    };
    document.addEventListener("visibilitychange", resume);
    reconnect();
    return () => {
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
      navigator.serviceWorker?.removeEventListener("message", acknowledged);
      document.removeEventListener("visibilitychange", resume);
      authorityPaused.current = true;
      stopCamera();
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [slug, operatorUserId, collectorContext?.epochId]);
  return { pending, setPending, pendingReadyScope, uploadStatus, setUploadStatus, sync, cancelRetries };
}
