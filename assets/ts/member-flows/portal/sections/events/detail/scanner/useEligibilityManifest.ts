import { useEffect, useRef, useState } from "preact/hooks";
import { prepareEligibilityManifest, type EligibilityManifest } from "./eligibility-manifest";

/** Prepares and refreshes scoped IDs-only data outside the camera path. */
export function useEligibilityManifest(
  slug: string,
  operatorUserId: string,
  occurrenceId: string | null,
  action: string,
  onPermissionChanged: () => void,
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
    setManifestError("");
    if (action !== "check" && action !== "attendance") return;
    const prepare = async () => {
      setManifestPreparing(true);
      try {
        const manifest = await prepareEligibilityManifest(slug, operatorUserId, occurrenceId, controller.signal);
        if (controller.signal.aborted) return;
        eligibilityManifest.current = manifest;
        setManifestReady(Date.now() < manifest.validUntil);
        setManifestError("");
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.message === "SCANNER_PERMISSION_CHANGED") {
          eligibilityManifest.current = null;
          permissionChanged.current();
        }
        setManifestReady(Boolean(eligibilityManifest.current && Date.now() < eligibilityManifest.current.validUntil));
        setManifestError("Eligibility data could not be refreshed. Unverified scans stay pending.");
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
  }, [slug, operatorUserId, occurrenceId, action]);
  return { eligibilityManifest, manifestReady, manifestPreparing, manifestError };
}
