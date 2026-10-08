import { useEffect, useState } from "preact/hooks";
import { registerPortalServiceWorker } from "../../../../portal-worker-registration";
import { prepareScannerDecoder } from "./prepareScannerDecoder";

const unavailable = "Offline camera files are not prepared. Use manual entry or a hardware scanner when offline.";
export function useScannerDecoderPreparation(scope: string) {
  const [status, setStatus] = useState("Preparing offline camera files…");
  useEffect(() => {
    const controller = new AbortController();
    const deadline = window.setTimeout(() => {
      controller.abort();
      setStatus(unavailable);
    }, 15000);
    setStatus("Preparing offline camera files…");
    void (async () => {
      try {
        if (!(await registerPortalServiceWorker())) throw new Error("Service workers are unavailable");
        const prepared = await prepareScannerDecoder(controller.signal);
        if (!controller.signal.aborted) setStatus(prepared ? "Offline camera files prepared." : unavailable);
      } catch {
        if (!controller.signal.aborted) setStatus(unavailable);
      } finally {
        window.clearTimeout(deadline);
      }
    })();
    return () => {
      controller.abort();
      window.clearTimeout(deadline);
    };
  }, [scope]);
  return status;
}
