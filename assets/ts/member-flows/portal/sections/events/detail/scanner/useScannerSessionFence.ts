import { portalSession } from "../../../../state";
import { useEffect, useRef } from "preact/hooks";
import { scannerUploadSuspended, subscribeUserSessionState } from "../../../../../../shared/pending-user-logout";

/** Pauses transient capture state in every tab without touching durable evidence. */
export function useScannerSessionFence(operatorUserId: string, pause: () => void, preparedSessionId?: string): void {
  const sessionId = preparedSessionId ?? portalSession.value?.sessionId;
  const latest = useRef(pause);
  latest.current = pause;
  useEffect(() => {
    let disposed = false;
    async function check() {
      if (await scannerUploadSuspended(operatorUserId, sessionId)) {
        if (!disposed) latest.current();
      }
    }
    const unsubscribe = subscribeUserSessionState(() => {
      void check();
    });
    void check();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [operatorUserId, sessionId]);
}
