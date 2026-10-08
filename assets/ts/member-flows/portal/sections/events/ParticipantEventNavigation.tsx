import type { z } from "zod";
import { availableScannerActions } from "../../../../../shared/event-scanner-permissions";
import { eventScannerAccessSchema } from "../../../../../shared/schemas/event-management";
import { hasEventAgendaPermission } from "./event-agenda-access";
import { Tabs, type TabItem } from "../../../../ui/Tabs";
import { ButtonLink } from "../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../ui/Panel";
import { Alert } from "../../../../ui/Alert";
import { usePortalHashLocation } from "../../hash-location";
import "./ParticipantEventNavigation.css";

type ScannerAccess = z.infer<typeof eventScannerAccessSchema>;
/** Discovery and current contextual grants must both permit each independent entry. */
export function participantScannerAccess(eventId: string, access?: ScannerAccess) {
  return {
    canScan:
      Boolean(access?.canScan) &&
      availableScannerActions((permission) => hasEventAgendaPermission(eventId, permission)).length > 0,
    sponsors:
      access?.sponsors.filter((sponsor) => hasEventAgendaPermission(eventId, "agenda:leads_capture", sponsor.id)) ?? [],
  };
}

export function ParticipantEventNavigation({
  eventId,
  slug,
  scannerAccess,
  items,
  activeId,
}: {
  eventId: string;
  slug: string;
  scannerAccess?: ScannerAccess;
  items: readonly TabItem[];
  activeId: string;
}) {
  const access = participantScannerAccess(eventId, scannerAccess);
  const base = `/events/${encodeURIComponent(slug)}`;
  return (
    <Tabs
      class="pk-participant-event__navigation"
      label="Event"
      activeId={activeId}
      items={[
        ...items,
        ...(access.canScan
          ? [{ id: "scanner", label: "Badge scanner", href: usePortalHashLocation.hrefs(base + "/scanner") }]
          : []),
        ...(access.sponsors.length
          ? [
              {
                id: "lead-scanner",
                label: "Lead scanner",
                href: usePortalHashLocation.hrefs(
                  access.sponsors.length === 1
                    ? `${base}/sponsors/${encodeURIComponent(access.sponsors[0]!.id)}/scanner`
                    : base + "/lead-scanner",
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

/** Every sponsor choice has its own canonical live scanner route. */
export function ParticipantLeadScanner({
  eventId,
  slug,
  scannerAccess,
}: {
  eventId: string;
  slug: string;
  scannerAccess?: ScannerAccess;
}) {
  const { sponsors } = participantScannerAccess(eventId, scannerAccess);
  if (!sponsors.length) return <Alert tone="danger">Lead scanning is not available for your current identity.</Alert>;
  return (
    <Panel>
      <PanelHeader title="Lead scanner" />
      <PanelBody>
        <div class="pk-stack">
          <p>Choose the sponsor you are scanning for.</p>
          <div class="pk-cluster">
            {sponsors.map((sponsor) => (
              <ButtonLink
                key={sponsor.id}
                href={usePortalHashLocation.hrefs(
                  `/events/${encodeURIComponent(slug)}/sponsors/${encodeURIComponent(sponsor.id)}/scanner`,
                )}
              >
                {sponsor.name}
              </ButtonLink>
            ))}
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}
