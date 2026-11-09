import { SCANNER_ELIGIBILITY_REFRESH_MS } from "../../../../../../../shared/event-offline-expiry";
import { saveScannerOfflineContext } from "./scanner-offline-context";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { scannerCollectorPath, scannerContextCurrent } from "./scanner-offline-context";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import type { PortalSession } from "../../../../types";
import type { ScannerEpoch } from "./scanner-device-ledger";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { ScannerCodePreparation, useScannerCodePreparationRetry } from "./scanner-code-preparation";
import { prepareEligibilityManifest, type EligibilityManifest } from "./eligibility-manifest";
import {
  eligibilityPreparationClosed,
  eligibilityRefreshError,
  eligibilityRefreshRefused,
} from "./eligibility-refresh-error";

export interface EligibilityManifestOptions {
  slug: string;
  operatorUserId: string;
  occurrenceId: string | null;
  action: EventScanRequest["action"];
  onPermissionChanged: () => void;
  roomId?: string | null;
  epoch: ScannerEpoch | null;
  collector?: boolean;
  onPreparationClosed?: (message: string) => void;
}

/** Prepares and refreshes scoped IDs-only data outside the camera path. */
export function useEligibilityManifest({
  slug,
  operatorUserId,
  occurrenceId,
  action,
  onPermissionChanged,
  roomId = null,
  epoch,
  collector = false,
  onPreparationClosed,
}: EligibilityManifestOptions) {
  const eligibilityManifest = useRef<EligibilityManifest | null>(null);
  const refusals = useRef({ onPermissionChanged, onPreparationClosed });
  refusals.current = { onPermissionChanged, onPreparationClosed };
  const [manifestReady, setManifestReady] = useState(false);
  const [manifestPreparing, setManifestPreparing] = useState(false);
  const [manifestError, setManifestError] = useState("");
  const [closedMessage, setClosedMessage] = useState("");
  useEffect(() => setClosedMessage(""), [epoch?.epochId]);
  const [manifestProgress, setManifestProgress] = useState<number | null>(null);
  const refreshRequest = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const controller = new AbortController();
    eligibilityManifest.current = null;
    setManifestReady(false);
    setManifestPreparing(false);
    setManifestError("");
    setManifestProgress(null);
    if (!epoch?.epochId || epoch.state !== "open") return;
    if (
      action !== "check" &&
      action !== "attendance" &&
      action !== "admission" &&
      action !== "exception" &&
      action !== "checkout"
    )
      return;
    const enrollment = { epochId: epoch.epochId, deviceId: epoch.deviceId };
    let refreshing = false;
    const prepare = async () => {
      if (refreshing || controller.signal.aborted) return;
      refreshing = true;
      const { onPermissionChanged: onRefusal, onPreparationClosed: onClosed } = refusals.current;
      setManifestPreparing(true);
      setManifestProgress(null);
      try {
        const manifest = await prepareEligibilityManifest(
          slug,
          operatorUserId,
          occurrenceId,
          enrollment,
          controller.signal,
          roomId,
          collector ? "cache" : "refresh",
          (checked) => {
            if (!controller.signal.aborted) setManifestProgress(checked);
          },
        );
        if (controller.signal.aborted) return;
        eligibilityManifest.current = manifest;
        setManifestReady(true);
        setManifestError(manifest.refreshError ?? "");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (eligibilityRefreshRefused(error)) {
          eligibilityManifest.current = null;
          if (eligibilityPreparationClosed(error)) {
            const message = eligibilityRefreshError(error);
            setClosedMessage(message);
            setManifestError("");
            setManifestReady(false);
            onClosed?.(message);
            return;
          }
          onRefusal();
        }
        setManifestReady(Boolean(eligibilityManifest.current));
        setManifestError(
          collector && !eligibilityRefreshRefused(error)
            ? "Prepared badge data is unavailable. Connect and refresh before scanning."
            : eligibilityRefreshError(error),
        );
      } finally {
        refreshing = false;
        if (!controller.signal.aborted) setManifestPreparing(false);
      }
    };
    refreshRequest.current = prepare;
    void prepare();
    const reconnect = () => {
      if (!collector && navigator.onLine) void prepare();
    };
    const visible = () => {
      if (document.visibilityState === "visible") reconnect();
    };
    const refresh = window.setInterval(reconnect, SCANNER_ELIGIBILITY_REFRESH_MS);
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      refreshRequest.current = async () => {};
      window.clearInterval(refresh);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [slug, operatorUserId, occurrenceId, action, roomId, epoch?.epochId, epoch?.state, epoch?.deviceId, collector]);
  return {
    eligibilityManifest,
    manifestReady,
    manifestPreparing,
    manifestError: closedMessage || manifestError,
    closedMessage,
    manifestProgress,
    refresh: () => refreshRequest.current(),
  };
}

/** Save only after a canonical session, open epoch and current manifest have prepared this view. */
export function useScannerOfflinePreparation(
  session: PortalSession | null,
  epoch: ScannerEpoch | null,
  manifest: EligibilityManifest | null,
  slug: string,
  action: EventScanRequest["action"],
) {
  const prepareCode = useContext(ScannerCodePreparation);
  const route = scannerCollectorPath(window.location.hash);
  const [prepared, setPrepared] = useState<ScannerOfflineContext | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const { attempt, retry } = useScannerCodePreparationRetry(() => !preparing && !current);
  const [, tick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPrepared(null);
    setError("");
    setPreparing(false);
    if (prepareCode && session && epoch && manifest) {
      setPreparing(true);
      void saveScannerOfflineContext({ slug, session, epoch, manifest, action, signal: controller.signal, prepareCode })
        .then((context) => {
          if (!controller.signal.aborted) {
            setPrepared(context);
            if (!context) setError("Offline preparation is not ready. Reconnect, check sign-in, and retry.");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setError("Offline preparation could not finish. Reconnect and retry.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreparing(false);
        });
    }
    return () => controller.abort();
  }, [slug, action, session, epoch, manifest, prepareCode, attempt, route]);
  useEffect(() => {
    if (!prepared) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [prepared]);
  const current =
    prepared &&
    session &&
    epoch?.state === "open" &&
    prepared.route === route &&
    prepared.slug === slug &&
    prepared.action === action &&
    prepared.operatorUserId === session.identity.id &&
    prepared.sessionId === session.sessionId &&
    prepared.epochId === epoch.epochId &&
    prepared.deviceId === epoch.deviceId &&
    prepared.occurrenceId === manifest?.occurrenceId &&
    prepared.roomId === (manifest?.roomId ?? null) &&
    prepared.serverNow === manifest?.serverNow &&
    scannerContextCurrent(prepared)
      ? prepared
      : null;
  return { context: current, preparing, error, retry };
}
