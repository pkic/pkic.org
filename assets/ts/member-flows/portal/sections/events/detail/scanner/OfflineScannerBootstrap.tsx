import { useEffect, useState } from "preact/hooks";
import { Alert } from "../../../../../../ui/Alert";
import { Spinner } from "../../../../../../ui/Spinner";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { subscribeUserSessionState } from "../../../../../../shared/pending-user-logout";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { listPreparedScannerContexts, restoreScannerOfflineContext } from "./scanner-offline-context";
import { EventScanner } from "./EventScanner";
import { LoginFrame } from "../../../../shell/LoginFrame";

/** The offline collector deliberately never mounts the authenticated portal shell. */
export function OfflineScannerBootstrap({ route, onCheckSignIn }: { route: string | null; onCheckSignIn: () => void }) {
  const [context, setContext] = useState<ScannerOfflineContext | null>(null);
  const [available, setAvailable] = useState<ScannerOfflineContext[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    async function check() {
      try {
        const saved = route ? await restoreScannerOfflineContext(route) : null;
        const choices = route ? [] : await listPreparedScannerContexts();
        if (!disposed) {
          setContext(saved);
          setAvailable(choices);
        }
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
  if (!route)
    return (
      <LoginFrame
        label="Prepared scanners on this device"
        title="Continue scanning offline"
        lede="Choose a prepared scanner. Scans will upload when your connection returns."
        copy={{ kicker: "Offline scanning", headline: "Keep event check-in running." }}
        foot={
          <Button type="button" variant="ghost" onClick={onCheckSignIn}>
            Check sign-in again
          </Button>
        }
      >
        {available.length ? (
          <div class="pk-login__controls pk-stack pk-stack--snug">
            {available.map((saved) => {
              const query = new URLSearchParams({ scanAction: saved.action });
              if (saved.purpose === "collection") query.set("scannerPurpose", "collection");
              const task = saved.purpose === "collection" ? "Badge collection" : "Event scanner";
              return (
                <ButtonLink
                  key={`${saved.epochId}:${saved.action}`}
                  href={`#${saved.route}?${query}`}
                  variant="secondary"
                >
                  {available.length === 1 ? task : `${task} · ${saved.slug.replaceAll("-", " ")}`}
                </ButtonLink>
              );
            })}
          </div>
        ) : (
          <Alert tone="warn">No prepared scanner is available on this device. Reconnect to prepare one.</Alert>
        )}
      </LoginFrame>
    );
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
