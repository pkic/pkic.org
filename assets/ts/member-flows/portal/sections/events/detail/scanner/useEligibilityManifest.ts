import { saveScannerOfflineContext } from "./scanner-offline-context";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import type { PortalSession } from "../../../../types";
import type { ScannerEpoch } from "./scanner-device-ledger";
import { useEffect, useRef, useState } from "preact/hooks";
import { prepareEligibilityManifest, type EligibilityManifest } from "./eligibility-manifest";

/** Prepares and refreshes scoped IDs-only data outside the camera path. */
export function useEligibilityManifest(
  slug: string,
  operatorUserId: string,
  occurrenceId: string | null,
  action: string,
  onPermissionChanged: () => void,
  roomId: string | null = null,
  epoch: ScannerEpoch | null,
  collector = false,
) {
  const eligibilityManifest = useRef<EligibilityManifest | null>(null);
  const permissionChanged = useRef(onPermissionChanged);
  permissionChanged.current = onPermissionChanged;
  const [manifestReady, setManifestReady] = useState(false);
  const [manifestPreparing, setManifestPreparing] = useState(false);
  const [manifestError, setManifestError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    eligibilityManifest.current = null;
    setManifestReady(false);
    setManifestPreparing(false);
    setManifestError("");
    if (collector || !epoch?.epochId || epoch.state !== "open") return;
    if (
      action !== "check" &&
      action !== "attendance" &&
      action !== "admission" &&
      action !== "exception" &&
      action !== "checkout"
    )
      return;
    const enrollment = { epochId: epoch.epochId, deviceId: epoch.deviceId };
    const prepare = async () => {
      const onRefusal = permissionChanged.current;
      setManifestPreparing(true);
      try {
        const manifest = await prepareEligibilityManifest(
          slug,
          operatorUserId,
          occurrenceId,
          enrollment,
          controller.signal,
          roomId,
        );
        if (controller.signal.aborted) return;
        eligibilityManifest.current = manifest;
        setManifestReady(true);
        setManifestError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.message === "SCANNER_PERMISSION_CHANGED") {
          eligibilityManifest.current = null;
          onRefusal();
        }
        setManifestReady(Boolean(eligibilityManifest.current));
        setManifestError(
          "Eligibility data could not be refreshed. Using the last saved registration data where available.",
        );
      } finally {
        if (!controller.signal.aborted) setManifestPreparing(false);
      }
    };
    void prepare();
    const refresh = window.setInterval(
      () => {
        void prepare();
      },
      2 * 60 * 1000,
    );
    return () => {
      controller.abort();
      window.clearInterval(refresh);
    };
  }, [slug, operatorUserId, occurrenceId, action, roomId, epoch?.epochId, epoch?.state, epoch?.deviceId, collector]);
  return { eligibilityManifest, manifestReady, manifestPreparing, manifestError };
}

/** Save only after a canonical session, open epoch and current manifest have prepared this view. */
export function useScannerOfflinePreparation(
  session: PortalSession | null,
  epoch: ScannerEpoch | null,
  manifest: EligibilityManifest | null,
  slug: string,
  action: EventScanRequest["action"],
) {
  useEffect(() => {
    const controller = new AbortController();
    if (session && epoch && manifest)
      void saveScannerOfflineContext({ slug, session, epoch, manifest, action, signal: controller.signal }).catch(
        () => {},
      );
    return () => controller.abort();
  }, [slug, action, session, epoch?.epochId, epoch?.state, manifest]);
}
