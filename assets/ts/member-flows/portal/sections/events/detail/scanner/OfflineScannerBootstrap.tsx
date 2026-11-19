import { useEffect, useState } from "preact/hooks";
import { Alert } from "../../../../../../ui/Alert";
import { Spinner } from "../../../../../../ui/Spinner";
import { Button } from "../../../../../../ui/Button";
import { ActionTiles } from "../../../../../../ui/ActionTile";
import { subscribeUserSessionState } from "../../../../../../shared/pending-user-logout";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { listPreparedScannerContexts, restoreScannerOfflineContext } from "./scanner-offline-context";
import { EventScanner } from "./EventScanner";
import { LoginFrame } from "../../../../shell/LoginFrame";
import { ScannerTaskTile } from "./ScannerDestinationTiles";

function preparedTaskOrder(context: ScannerOfflineContext): number {
  if (context.purpose === "collection") return 0;
  if (context.occurrenceId) return 5;
  return context.action === "attendance" ? 1 : context.action === "admission" ? 2 : context.action === "check" ? 3 : 4;
}

/** The offline collector deliberately never mounts the authenticated portal shell. */
export function OfflineScannerBootstrap({ route, onCheckSignIn }: { route: string | null; onCheckSignIn: () => void }) {
  const [context, setContext] = useState<ScannerOfflineContext | null>(null);
  const [available, setAvailable] = useState<ScannerOfflineContext[]>([]);
  const [loading, setLoading] = useState(true);
  const routeQuery = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const selectionKey = route
    ? [routeQuery.get("offlineContext"), routeQuery.get("scanAction"), routeQuery.get("scannerPurpose")].join(":")
    : "";
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
  }, [route, selectionKey]);
  if (loading || (context && context.route !== route)) return <Spinner label="Checking saved scanner context…" />;
  const multipleEvents = available.some((item) => item.slug !== available[0]?.slug);
  if (!route)
    return (
      <div class="pk-scanner-offline-entry">
        <LoginFrame
          label="Prepared scanners on this device"
          title="Continue scanning offline"
          lede="Scans will upload when your connection returns."
          copy={{ kicker: "Offline scanning", headline: "Keep event check-in running." }}
          foot={
            <Button type="button" variant="ghost" onClick={onCheckSignIn}>
              Check sign-in again
            </Button>
          }
        >
          {available.length ? (
            <div class="pk-scanner-destinations">
              <ActionTiles label="Choose a prepared scanner task">
                {[...available]
                  .sort(
                    (a, b) =>
                      a.slug.localeCompare(b.slug) ||
                      preparedTaskOrder(a) - preparedTaskOrder(b) ||
                      (a.targetLabel ?? "").localeCompare(b.targetLabel ?? "") ||
                      a.action.localeCompare(b.action),
                  )
                  .map((saved) => {
                    const query = new URLSearchParams({ scanAction: saved.action });
                    if (saved.purpose === "collection") query.set("scannerPurpose", "collection");
                    if (saved.contextId) query.set("offlineContext", saved.contextId);
                    return (
                      <li
                        key={
                          saved.contextId ??
                          `${saved.epochId}:${saved.action}:${saved.purpose}:${saved.occurrenceId}:${saved.roomId}`
                        }
                      >
                        <ScannerTaskTile
                          action={saved.action}
                          purpose={saved.purpose}
                          occurrenceId={saved.occurrenceId}
                          targetLabel={saved.targetLabel}
                          roomLabel={saved.roomLabel}
                          eventLabel={multipleEvents ? saved.slug.replaceAll("-", " ") : undefined}
                          href={`#${saved.route}?${query}`}
                        />
                      </li>
                    );
                  })}
              </ActionTiles>
            </div>
          ) : (
            <Alert tone="warn">No prepared scanner is available on this device. Reconnect to prepare one.</Alert>
          )}
        </LoginFrame>
      </div>
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
