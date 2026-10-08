import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { lastSuccessfulScanSync } from "./scan-history";
import { scannerUploadStatusMessageSchema } from "../../../../../../../shared/schemas/event-scan-upload-status";

/** Read retained upload acknowledgments on mount and completed drains, outside the capture path. */
export function useScannerSyncHistory(operatorUserId: string, eventId: string) {
  const scope = JSON.stringify([operatorUserId, eventId]);
  const current = useRef(scope);
  current.current = scope;
  const [value, setValue] = useState<{ scope: string; time: string | null | undefined }>();
  const refresh = useCallback(async () => {
    try {
      const time = await lastSuccessfulScanSync(operatorUserId, eventId);
      if (current.current === scope) setValue({ scope, time });
    } catch {
      if (current.current === scope) setValue({ scope, time: undefined });
    }
  }, [operatorUserId, eventId]);
  useEffect(() => {
    current.current = scope;
    void refresh();
    const acknowledged = (event: MessageEvent<unknown>) => {
      const status = scannerUploadStatusMessageSchema.safeParse(event.data);
      if (status.success && status.data.uploaded > 0) void refresh();
    };
    navigator.serviceWorker?.addEventListener("message", acknowledged);
    return () => {
      current.current = "";
      navigator.serviceWorker?.removeEventListener("message", acknowledged);
    };
  }, [refresh]);
  return { lastSync: value?.scope === scope ? value.time : undefined, refresh };
}
