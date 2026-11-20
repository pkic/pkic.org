import { SCANNER_ELIGIBILITY_REFRESH_MS } from "../../../../../../../shared/event-offline-expiry";
import { saveScannerOfflineContext } from "./scanner-offline-context";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { scannerCollectorPath, scannerContextCurrent } from "./scanner-offline-context";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import type { PortalSession } from "../../../../types";
import type { ScannerEpoch } from "./scanner-device-ledger";
import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ScannerCodePreparation, useScannerCodePreparationRetry } from "./scanner-code-preparation";
import { prepareEligibilityManifest, type EligibilityManifest } from "./eligibility-manifest";
import {
  SCANNER_PREPARATION_CLOSED_MESSAGE,
  SCANNER_PREPARATION_CLOSING_MESSAGE,
  EligibilityRefreshFailure,
  eligibilityPreparationStopped,
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
  includeBadgeNames?: boolean;
  onPreparationClosed?: (message: string, code: string) => void;
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
  includeBadgeNames = false,
  onPreparationClosed,
}: EligibilityManifestOptions) {
  const eligibilityManifest = useRef<EligibilityManifest | null>(null);
  const scopeKey = JSON.stringify([
    slug,
    operatorUserId,
    occurrenceId,
    action,
    roomId,
    epoch?.epochId,
    epoch?.state,
    epoch?.deviceId,
    collector,
    includeBadgeNames,
  ]);
  const [manifestScope, setManifestScope] = useState<string | null>(null);
  const refusals = useRef({ onPermissionChanged, onPreparationClosed });
  refusals.current = { onPermissionChanged, onPreparationClosed };
  const [manifestReady, setManifestReady] = useState(false);
  const [manifestPreparing, setManifestPreparing] = useState(false);
  const [manifestError, setManifestError] = useState("");
  const [closedMessage, setClosedMessage] = useState("");
  const closedEpochId = useRef<string | null>(null);
  useEffect(() => {
    closedEpochId.current = null;
    setClosedMessage("");
  }, [epoch?.epochId]);
  const [manifestProgress, setManifestProgress] = useState<number | null>(null);
  const refreshRequest = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const controller = new AbortController();
    setManifestScope(scopeKey);
    eligibilityManifest.current = null;
    setManifestReady(false);
    setManifestPreparing(false);
    setManifestError("");
    setManifestProgress(null);
    if (epoch?.state === "closed" || epoch?.state === "closing") {
      closedEpochId.current = epoch.epochId;
      setClosedMessage(
        epoch.state === "closing" ? SCANNER_PREPARATION_CLOSING_MESSAGE : SCANNER_PREPARATION_CLOSED_MESSAGE,
      );
    }
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
    let automaticRefreshAt = 0;
    const prepare = async () => {
      if (refreshing || controller.signal.aborted || closedEpochId.current === enrollment.epochId) return;
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
          includeBadgeNames,
        );
        if (controller.signal.aborted) return;
        eligibilityManifest.current = manifest;
        automaticRefreshAt = manifest.retryAfterMs ? Date.now() + manifest.retryAfterMs : 0;
        setManifestReady(true);
        setManifestError(manifest.storageError ?? manifest.refreshError ?? "");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof EligibilityRefreshFailure && error.retryAfterMs)
          automaticRefreshAt = Date.now() + error.retryAfterMs;
        if (eligibilityRefreshRefused(error)) {
          eligibilityManifest.current = null;
          if (error instanceof Error && eligibilityPreparationStopped(error.message)) {
            closedEpochId.current = enrollment.epochId;
            const message = eligibilityRefreshError(error);
            setClosedMessage(message);
            setManifestError("");
            setManifestReady(false);
            onClosed?.(message, error.message);
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
      if (!collector && navigator.onLine && Date.now() >= automaticRefreshAt) void prepare();
    };
    const visible = () => {
      if (document.visibilityState === "visible") reconnect();
    };
    const refresh = window.setInterval(reconnect, SCANNER_ELIGIBILITY_REFRESH_MS + Math.floor(Math.random() * 30_000));
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
  }, [
    slug,
    operatorUserId,
    occurrenceId,
    action,
    roomId,
    epoch?.epochId,
    epoch?.state,
    epoch?.deviceId,
    collector,
    includeBadgeNames,
    scopeKey,
  ]);
  const [, updateExpiry] = useState(0);
  const namesDeadline =
    includeBadgeNames && manifestScope === scopeKey ? eligibilityManifest.current?.validUntil : undefined;
  useEffect(() => {
    if (namesDeadline === undefined || !Number.isFinite(namesDeadline) || namesDeadline <= Date.now()) return;
    let timer: number;
    const observeExpiry = () => {
      const remaining = namesDeadline - Date.now();
      if (remaining <= 0) {
        updateExpiry((value) => value + 1);
        return;
      }
      // Browser timers cannot represent the full event window in one signed 32-bit delay.
      timer = window.setTimeout(observeExpiry, Math.min(remaining, 2_147_483_647));
    };
    observeExpiry();
    return () => window.clearTimeout(timer);
  }, [scopeKey, namesDeadline]);
  const scopeMatches = scopeKey === manifestScope;
  const namesExpired = Boolean(
    includeBadgeNames && eligibilityManifest.current && Date.now() >= eligibilityManifest.current.validUntil,
  );
  return {
    eligibilityManifest,
    manifestReady: scopeMatches && manifestReady && !namesExpired,
    manifestPreparing: scopeMatches ? manifestPreparing : Boolean(epoch?.state === "open"),
    manifestError: scopeMatches
      ? closedMessage ||
        (namesExpired ? "Offline badge names have expired. Reconnect to prepare this device." : manifestError)
      : "",
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
  targetLabel?: string,
  roomLabel?: string,
  expectedScope?: { occurrenceId: string | null; roomId: string | null },
  allowedActions?: readonly EventScanRequest["action"][],
  purpose: "scan" | "collection" = "scan",
) {
  const preparedActions = useMemo(() => allowedActions ?? [action], [allowedActions, action]);
  const prepareCode = useContext(ScannerCodePreparation);
  const route = scannerCollectorPath(window.location.hash);
  const hasExpectedScope = expectedScope !== undefined;
  const expectedOccurrenceId = expectedScope?.occurrenceId;
  const expectedRoomId = expectedScope?.roomId;
  const [prepared, setPrepared] = useState<ScannerOfflineContext | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const { attempt, retry } = useScannerCodePreparationRetry(() => !preparing && !current);
  const [, tick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setPreparing(false);
    if (
      prepareCode &&
      session &&
      epoch &&
      manifest &&
      (!hasExpectedScope ||
        (manifest.occurrenceId === expectedOccurrenceId && (manifest.roomId ?? null) === expectedRoomId))
    ) {
      setPreparing(true);
      void saveScannerOfflineContext({
        slug,
        session,
        epoch,
        manifest,
        action,
        purpose,
        allowedActions: preparedActions,
        targetLabel,
        roomLabel,
        signal: controller.signal,
        prepareCode,
      })
        .then((context) => {
          if (!controller.signal.aborted) {
            if (context) setPrepared(context);
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
  }, [
    slug,
    action,
    purpose,
    preparedActions,
    targetLabel,
    roomLabel,
    hasExpectedScope,
    expectedOccurrenceId,
    expectedRoomId,
    session,
    epoch,
    manifest,
    prepareCode,
    attempt,
    route,
  ]);
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
    (prepared.purpose ?? "scan") === purpose &&
    prepared.operatorUserId === session.identity.id &&
    prepared.sessionId === session.sessionId &&
    prepared.epochId === epoch.epochId &&
    prepared.deviceId === epoch.deviceId &&
    prepared.occurrenceId === manifest?.occurrenceId &&
    prepared.roomId === (manifest?.roomId ?? null) &&
    (!hasExpectedScope || (prepared.occurrenceId === expectedOccurrenceId && prepared.roomId === expectedRoomId)) &&
    scannerContextCurrent(prepared)
      ? prepared
      : null;
  return { context: current, preparing, error, retry };
}
