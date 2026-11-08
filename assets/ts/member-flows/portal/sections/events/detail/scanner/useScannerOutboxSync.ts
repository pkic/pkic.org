import { useEffect, useRef, useState } from "preact/hooks";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import {
  eventScanResponseSchema,
  type EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { drainScanOutbox, pendingScanCount, requestScanOutboxBackgroundSync } from "./scan-outbox";
import { scannerReceiptMatches } from "./scanner-receipt";
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
  const [syncing, setSyncing] = useState(false);
  const [pendingReadyScope, setPendingReadyScope] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const retryTimer = useRef<number | null>(null);
  const activeSyncs = useRef(0);
  const syncAgain = useRef(false);
  const generation = useRef(0);
  const verificationWaiters = useRef(new Map<string, (confirmed: boolean) => void>());
  function cancelVerification() {
    for (const finish of verificationWaiters.current.values()) finish(false);
  }
  function received(receipt: EventScanResponse) {
    presentReceipt(receipt);
    verificationWaiters.current.get(receipt.operationId)?.(true);
  }
  /** Await the existing queue's receipt; never create a second scan operation or retry path. */
  async function verifyQueuedScan(operationId: string): Promise<boolean> {
    if (collectorContext || authorityPaused.current) return false;
    return new Promise((resolve) => {
      const finish = (confirmed: boolean) => {
        window.clearTimeout(timeout);
        verificationWaiters.current.delete(operationId);
        resolve(confirmed);
      };
      const timeout = window.setTimeout(() => finish(false), 2000);
      verificationWaiters.current.set(operationId, finish);
      if (activeSyncs.current === 0) void sync().catch(() => finish(false));
    });
  }

  async function scanSaved() {
    setUploadStatus(collectorContext ? "Saved on this device · upload pending" : "Uploading scans in the background…");
    try {
      setPending(await pendingScanCount(operatorUserId));
    } catch {
      // Counting is ancillary: the operation has already been saved durably.
    } finally {
      void sync();
    }
  }
  function cancelRetries() {
    syncAgain.current = false;
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
  }
  async function sync() {
    const activeGeneration = generation.current;
    const isCurrent = () => generation.current === activeGeneration;
    if (collectorContext) {
      activeSyncs.current++;
      setSyncing(true);
      try {
        setPending(await pendingScanCount(operatorUserId));
        setPendingReadyScope(`${slug}:${operatorUserId}`);
        setUploadStatus("Reconnect and check sign-in to verify and upload.");
      } catch {
        if (isCurrent()) setUploadStatus("Local scan storage is unavailable. Reopen the scanner to retry.");
      } finally {
        activeSyncs.current--;
        setSyncing(activeSyncs.current > 0);
      }
      return;
    }
    if (activeSyncs.current >= 4) {
      syncAgain.current = true;
      return;
    }
    activeSyncs.current++;
    setSyncing(true);
    try {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      let uploadFailure = "";
      const drained = await drainScanOutbox(
        async (record) => {
          const response = await fetch(
            `/api/v1/events/${encodeURIComponent(record.eventId)}/scans${record.kind === "failure" ? "/failures" : ""}`,
            {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(record.scan),
              signal: AbortSignal.timeout(8000),
            },
          );
          if (response.ok) {
            const receipt = eventScanResponseSchema.safeParse(
              await response
                .clone()
                .json()
                .catch(() => null),
            );
            if (receipt.success && scannerReceiptMatches(receipt.data, record.scan)) {
              if (record.kind === "scan") received(receipt.data);
            } else uploadFailure = "Scan upload was not confirmed. Saved on this device; retrying automatically.";
          }
          if (!response.ok)
            uploadFailure = `Scan upload failed (HTTP ${response.status}). Saved on this device; retrying automatically.`;
          return response;
        },
        operatorUserId,
        undefined,
        () => verificationWaiters.current.keys().next().value,
      );
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
      if (remaining > 0 && drained.state !== "authentication_required" && drained.state !== "recovery_required")
        await requestScanOutboxBackgroundSync();
      if (isCurrent() && drained.state === "retry" && navigator.onLine)
        retryTimer.current = window.setTimeout(() => {
          void sync();
        }, drained.retryAfterMs ?? 1000);
      if (authorityPaused.current) setMessage("Sign in again to upload pending scans.");
      setUploadStatus(
        drained.state === "recovery_required"
          ? "A retained scan uses an unsupported capture format. It has not been deleted. Open Diagnostics for recovery."
          : authorityPaused.current
            ? "Sign in again to upload pending scans."
            : uploadFailure
              ? uploadFailure
              : remaining === 0
                ? "All pending scans uploaded."
                : drained.state === "retry"
                  ? "Uploads will resume when connected."
                  : "Uploading scans in the background…",
      );
    } catch {
      if (isCurrent()) setUploadStatus("Sync unavailable. Scans remain saved on this device; retrying automatically.");
      if (isCurrent() && !authorityPaused.current && navigator.onLine)
        retryTimer.current = window.setTimeout(() => {
          void sync();
        }, 2000);
    } finally {
      activeSyncs.current--;
      setSyncing(activeSyncs.current > 0);
      if (isCurrent() && syncAgain.current) {
        syncAgain.current = false;
        void sync();
      }
      if (activeSyncs.current === 0) cancelVerification();
    }
  }
  const lifecycle = useRef({ sync, currentOperation, authorityPaused, presentReceipt: received, stopCamera });
  lifecycle.current = { sync, currentOperation, authorityPaused, presentReceipt: received, stopCamera };
  useEffect(() => {
    const scopeGeneration = generation;
    scopeGeneration.current++;
    setPendingReadyScope(null);
    const stop = () => {
      lifecycle.current.authorityPaused.current = true;
      lifecycle.current.stopCamera();
    };
    const reconnect = () => {
      void lifecycle.current.sync();
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    const acknowledged = scannerWorkerMessageListener({
      currentOperation: () => lifecycle.current.currentOperation(),
      authorityPaused: () => lifecycle.current.authorityPaused.current,
      setResult: (receipt) => lifecycle.current.presentReceipt(receipt),
      refreshPending: () => {
        void pendingScanCount(operatorUserId)
          .then(setPending)
          .catch(() => {
            setUploadStatus("Sync unavailable. Scans remain saved on this device; refresh the scanner to retry.");
          });
      },
      syncCurrentOperator: () => {
        void lifecycle.current.sync().catch(() => {
          setUploadStatus("Sync unavailable. Scans remain saved on this device; refresh the scanner to retry.");
        });
      },
    });
    navigator.serviceWorker?.addEventListener("message", acknowledged);
    const resume = () => {
      if (document.visibilityState === "visible") reconnect();
    };
    document.addEventListener("visibilitychange", resume);
    reconnect();
    return () => {
      scopeGeneration.current++;
      cancelVerification();
      syncAgain.current = false;
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
      navigator.serviceWorker?.removeEventListener("message", acknowledged);
      document.removeEventListener("visibilitychange", resume);
      stop();
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [slug, operatorUserId, collectorContext?.epochId]);
  return {
    syncing,
    pending,
    scanSaved,
    pendingReadyScope,
    uploadStatus,
    sync,
    verifyQueuedScan,
    cancelVerification,
    cancelRetries,
  };
}
