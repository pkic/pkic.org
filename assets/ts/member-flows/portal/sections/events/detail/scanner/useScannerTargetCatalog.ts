import { useEffect, useState } from "preact/hooks";
import {
  scannerTargetsResponseSchema,
  type ScannerTargetsResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { getJson } from "../../../../../../shared/api-client";

/** Room metadata is bounded by the canonical scanner catalog, outside badge capture. */
export function useScannerTargetCatalog(slug: string, enabled = true) {
  const [catalog, setCatalog] = useState<ScannerTargetsResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null);
    setError("");
    if (enabled)
      void getJson(`/api/v1/events/${encodeURIComponent(slug)}/scans/targets?limit=1`, scannerTargetsResponseSchema, {
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setCatalog(data);
        })
        .catch(() => {
          if (!controller.signal.aborted) setError("Rooms are unavailable. Reconnect and try again.");
        });
    return () => controller.abort();
  }, [slug, enabled]);
  return { catalog, error };
}
