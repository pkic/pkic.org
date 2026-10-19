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
export function EventStaffScanner({ eventId, slug }: { eventId: string; slug: string }) {
  const can = (permission: Permission) => hasEventAgendaPermission(eventId, permission);
  const actions = availableScannerActions(can);
  const canAdmitExceptions = can("agenda:admit_exceptions") && Boolean(scannerPermission(can, "agenda:admit"));
  const operator = portalSession.value?.identity.id ?? "";
  return (
    <Suspense fallback={<Spinner />}>
      <EventScanner
        key={`${eventId}:${slug}:${operator}`}
        slug={slug}
        operatorUserId={operator}
        allowedActions={[...actions, ...(canAdmitExceptions ? ["exception" as const] : [])]}
        canAdmitExceptions={canAdmitExceptions}
      />
    </Suspense>
  );
}
