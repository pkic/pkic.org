import { useEffect, useState } from "preact/hooks";
import { Alert } from "../../../../../../ui/Alert";
import { Spinner } from "../../../../../../ui/Spinner";
import { Button } from "../../../../../../ui/Button";
import { subscribeUserSessionState } from "../../../../../../shared/pending-user-logout";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { restoreScannerOfflineContext } from "./scanner-offline-context";
import { EventScanner } from "./EventScanner";

/** The offline collector deliberately never mounts the authenticated portal shell. */
export function OfflineScannerBootstrap({ route, onCheckSignIn }: { route: string; onCheckSignIn: () => void }) {
  const [context, setContext] = useState<ScannerOfflineContext | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    async function check() {
      try {
        const saved = await restoreScannerOfflineContext(route);
        if (!disposed) setContext(saved);
      } catch {
        if (!disposed) setContext(null);
      } finally {
        if (!disposed) setLoading(false);
      }
    }
    const unsubscribe = subscribeUserSessionState(() => {
      void check();
    });
    const timer = window.setInterval(() => {
      void check();
    }, 1000);
    void check();
    return () => {
      disposed = true;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [route]);
  if (loading || (context && context.route !== route)) return <Spinner label="Checking saved scanner context…" />;
  return (
    <>
      {!context ? (
        <Alert tone="warn" title="Reconnect to continue scanning">
          <div class="pk-stack pk-stack--snug">
            <p>The saved scanner session is unavailable or expired. Pending scans remain on this device.</p>
            <div class="pk-cluster">
              <Button type="button" variant="secondary" onClick={onCheckSignIn}>
                Check sign-in again
              </Button>
            </div>
          </div>
        </Alert>
      ) : (
        <EventScanner
          key={`${context.sessionId}:${context.epochId}:${context.action}:${context.occurrenceId}:${context.roomId}`}
          slug={context.slug}
          operatorUserId={context.operatorUserId}
          occurrenceId={context.occurrenceId}
          allowedActions={[context.action]}
          collectorContext={context}
          onCheckSignIn={onCheckSignIn}
        />
      )}
    </>
  );
}
