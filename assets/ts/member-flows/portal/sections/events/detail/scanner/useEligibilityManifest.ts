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
    const prepare = async () => {
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
          permissionChanged.current();
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
  }, [slug, operatorUserId, occurrenceId, action, roomId, epoch?.epochId, epoch?.state, epoch?.deviceId]);
  return { eligibilityManifest, manifestReady, manifestPreparing, manifestError };
}
