import { createContext } from "preact";
import { useEffect, useState } from "preact/hooks";

/** The portal entry owns public UI loading; scanner persistence never imports that UI. */
export const ScannerCodePreparation = createContext<((signal: AbortSignal) => Promise<boolean>) | null>(null);

/** A cold install can finish after a caller's deadline; retry once control or connectivity returns. */
export function useScannerCodePreparationRetry() {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const retry = () => setAttempt((value) => value + 1);
    navigator.serviceWorker?.addEventListener?.("controllerchange", retry);
    window.addEventListener("online", retry);
    return () => {
      navigator.serviceWorker?.removeEventListener?.("controllerchange", retry);
      window.removeEventListener("online", retry);
    };
  }, []);
  return { attempt, retry: () => setAttempt((value) => value + 1) };
}
