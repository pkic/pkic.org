import { useEffect, useState } from "preact/hooks";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { Alert } from "../../../../../../ui/Alert";
import { Spinner } from "../../../../../../ui/Spinner";
import { Button } from "../../../../../../ui/Button";
import { ActionTiles } from "../../../../../../ui/ActionTile";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { subscribeUserSessionState } from "../../../../../../shared/pending-user-logout";
import type { ScannerOfflineContext } from "../../../../../../../shared/schemas/event-scanner-offline-context";
import { listPreparedScannerContexts, restoreScannerOfflineContext } from "./scanner-offline-context";
import { EventScanner } from "./EventScanner";
import { LoginFrame } from "../../../../../../components/sign-in/LoginFrame";
import { ScannerTaskTile } from "./ScannerDestinationTiles";

function preparedTaskOrder(context: ScannerOfflineContext): number {
  if (context.purpose === "collection") return 0;
  if (context.occurrenceId) return 5;
  return context.action === "lead"
    ? 1
    : context.action === "attendance"
      ? 2
      : context.action === "admission"
        ? 3
        : context.action === "check"
          ? 4
          : 5;
}

/** The offline collector deliberately never mounts the authenticated portal shell. */
export function OfflineScannerBootstrap({ route, onSignIn }: { route: string | null; onSignIn: () => void }) {
  const [context, setContext] = useState<ScannerOfflineContext | null>(null);
  const [available, setAvailable] = useState<ScannerOfflineContext[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvedSelection, setResolvedSelection] = useState<string | null>(null);
  const routeQuery = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const selectionKey = route
    ? [routeQuery.get("offlineContext"), routeQuery.get("scanAction"), routeQuery.get("scannerPurpose")].join(":")
    : "";
  const currentSelection = `${route ?? ""}?${selectionKey}`;
  useEffect(() => {
    let disposed = false;
    setLoading(true);
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
        if (!disposed) {
          setResolvedSelection(currentSelection);
          setLoading(false);
        }
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
  }, [route, currentSelection]);
  const eventSlugs = [...new Set(available.map((item) => item.slug))].sort((a, b) => {
    const latest = (slug: string) =>
      Math.max(...available.filter((item) => item.slug === slug).map((item) => Date.parse(item.lastObservedAt)));
    return latest(b) - latest(a) || a.localeCompare(b);
  });
  const [currentEvent, setSelectedEvent] = useHashQueryParam("scannerEvent", eventSlugs[0] ?? "", eventSlugs);
  if (loading || resolvedSelection !== currentSelection || (context && context.route !== route))
    return <Spinner label="Checking saved scanner context…" />;
  const eventLabel = (slug: string) =>
    slug
      .split("-")
      .map((part, index, parts) =>
        part === "pqc" || part === "pki" || (index === parts.length - 1 && part.length === 2)
          ? part.toUpperCase()
          : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
      )
      .join(" ");
  if (!route)
    return (
      <div class="pk-scanner-offline-entry">
        <LoginFrame
          label="Prepared scanners on this device"
          title="Continue scanning offline"
          lede="Scans stay on this device until you sign in to upload them."
          copy={{ kicker: "Offline scanning", headline: "Keep event check-in running." }}
        >
          <div class="pk-cluster">
            <Button type="button" onClick={onSignIn}>
              Sign in
            </Button>
          </div>
          {available.length ? (
            <div class="pk-scanner-destinations">
              {eventSlugs.length > 1 && (
                <Field label="Event">
                  {(control) => (
                    <Select
                      {...control}
                      value={currentEvent}
                      onChange={(event) => setSelectedEvent(event.currentTarget.value)}
                    >
                      {eventSlugs.map((slug) => (
                        <option key={slug} value={slug}>
                          {eventLabel(slug)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <ActionTiles label={`Choose a prepared scanner task for ${eventLabel(currentEvent ?? "")}`}>
                {[...available]
                  .filter((saved) => saved.slug === currentEvent)
                  .sort(
                    (a, b) =>
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
              <Button type="button" onClick={onSignIn}>
                Sign in
              </Button>
            </div>
          </div>
        </Alert>
      ) : (
        <EventScanner
          key={`${context.sessionId}:${context.epochId}:${context.action}:${context.sponsorId}:${context.occurrenceId}:${context.roomId}`}
          slug={context.slug}
          operatorUserId={context.operatorUserId}
          occurrenceId={context.occurrenceId}
          allowedActions={[context.action]}
          sponsorId={context.sponsorId}
          sponsorName={context.action === "lead" ? context.targetLabel : undefined}
          collectorContext={context}
          onSignIn={onSignIn}
        />
      )}
    </>
  );
}
