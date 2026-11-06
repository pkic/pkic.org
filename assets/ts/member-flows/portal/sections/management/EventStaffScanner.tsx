import type { ScannerRole } from "../events/detail/scanner/scanner-role";
import { scannerEntranceAction } from "../events/detail/scanner/ScannerModeSelect";
import { useCallback, useState } from "preact/hooks";
import {
  ScannerTaskNavigation,
  type ScannerTask,
  type ScannerTaskDestination,
} from "../events/detail/scanner/ScannerTaskNavigation";
import { BadgeLabelDesk } from "../events/detail/badges/BadgeLabelDesk";
import { lazy, Suspense } from "preact/compat";
import { scannerPermission, availableScannerActions } from "../../../../../shared/event-scanner-permissions";
import type { Permission } from "../../../../../shared/schemas/permissions";
import { Spinner } from "../../../../components/Spinner";
import { portalSession } from "../../state";
import { hasEventAgendaPermission } from "../events/event-agenda-access";
const EventScanner = lazy(() =>
  import("../events/detail/scanner/EventScanner").then((module) => ({ default: module.EventScanner })),
);
/** Scope the shared scanner to this event and remount its device state when the operator changes. */
export function EventStaffScanner({
  eventId,
  slug,
  basePath,
  section,
  canPrintLabels = false,
}: {
  eventId: string;
  slug: string;
  basePath: string;
  section?: string;
  canPrintLabels?: boolean;
}) {
  const [launch, setLaunch] = useState<ScannerTask | null>(null);
  const [gradientFrom, setGradientFrom] = useState<ScannerRole>();
  const [captureVersion, setCaptureVersion] = useState(0);
  const consumeLaunch = useCallback(() => {
    setLaunch(null);
    setGradientFrom(undefined);
  }, []);
  const can = (permission: Permission) => hasEventAgendaPermission(eventId, permission);
  const actions = availableScannerActions(can);
  const canAdmitExceptions = can("agenda:admit_exceptions") && Boolean(scannerPermission(can, "agenda:admit"));
  const operator = portalSession.value?.identity.id ?? "";
  const printHref = canPrintLabels ? `#${basePath}/print` : undefined;
  const entryAction = scannerEntranceAction(actions);
  const tasks: ScannerTaskDestination[] = [
    ...(actions.includes(entryAction)
      ? [{ key: "entry" as const, label: "Entry", href: `#${basePath}`, action: entryAction }]
      : []),
    ...(actions.includes("checkout")
      ? [{ key: "exit" as const, label: "Exit", href: `#${basePath}`, action: "checkout" as const }]
      : []),
    ...(printHref ? [{ key: "print" as const, label: "Print", href: printHref }] : []),
  ];
  function launchTask(task: ScannerTask, from?: ScannerRole) {
    const destination = tasks.find((item) => item.key === task);
    if (!destination) return;
    setGradientFrom(from);
    setLaunch(task);
    if (task !== "print" && section !== "print") setCaptureVersion((value) => value + 1);
    window.location.hash = destination.href;
  }
  return (
    <ScannerTaskNavigation.Provider
      value={{ launch, gradientFrom, tasks, onLaunch: launchTask, onConsumed: consumeLaunch }}
    >
      <div class="pk-stack">
        {section === "print" && canPrintLabels ? (
          <BadgeLabelDesk slug={slug} />
        ) : (
          <Suspense fallback={<Spinner />}>
            <EventScanner
              key={`${eventId}:${slug}:${operator}:${captureVersion}`}
              slug={slug}
              printHref={printHref}
              operatorUserId={operator}
              allowedActions={[...actions, ...(canAdmitExceptions ? ["exception" as const] : [])]}
              canAdmitExceptions={canAdmitExceptions}
            />
          </Suspense>
        )}
      </div>
    </ScannerTaskNavigation.Provider>
  );
}
