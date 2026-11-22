import type { z } from "zod";
import { eventDetailResponseSchema, eventScannerAccessSchema } from "../../../../../shared/schemas/event-management";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { participantScannerAccess } from "./app/participant-scanner-access";
import { Tabs, type TabItem } from "../../../../ui/Tabs";
import { ButtonLink } from "../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../ui/Panel";
import { Alert } from "../../../../ui/Alert";
import { usePortalHashLocation } from "../../hash-location";
import { EventAppBar } from "./app/EventAppBar";
import { eventAppDestinations, participantEventAppSubject, type EventAppSubject } from "./app/event-app-tabs";
import { portalSession } from "../../state";
import "./ParticipantEventNavigation.css";

type ScannerAccess = z.infer<typeof eventScannerAccessSchema>;

export function ParticipantEventNavigation({
  event,
  items,
  activeId,
  appBar = true,
}: {
  event: EventAppSubject;
  items: readonly TabItem[];
  activeId: string;
  /** False on a page that brings a bottom bar of its own, as the virtual room does on a phone. */
  appBar?: boolean;
}) {
  const base = `/events/${encodeURIComponent(event.slug)}`;
  const operatorDestinations = eventAppDestinations(event, portalSession.value).filter((destination) =>
    ["scanner", "lead-scanner", "sponsor-leads"].includes(destination.id),
  );
  return (
    <>
      {/* Desktop and tablets: the page's own top tabs. Phones: the event app's bottom bar. */}
      <Tabs
        class="pk-participant-event__navigation"
        label="Event"
        activeId={activeId}
        items={[
          ...items,
          // The open scanner stays named even if its live discovery response has not arrived.
          ...(activeId === "scanner" && !operatorDestinations.some((destination) => destination.id === "scanner")
            ? [{ id: "scanner", label: "Badge scanner", href: usePortalHashLocation.hrefs(base + "/scanner") }]
            : []),
          ...operatorDestinations.map(({ id, label, href }) => ({ id, label, href })),
        ]}
      />
      {appBar && <EventAppBar event={event} activeId={activeId} />}
    </>
  );
}

/**
 * The scanner page's navigation. The scanner keeps only its minimal event
 * metadata, so the reader's standing comes from the live participant
 * projection, and the bar offers the same tabs as every other event page.
 * Offline, or until that read lands, the scanner's own projection stands in.
 */
export function ScannerEventNavigation({
  event,
  items,
  activeId,
}: {
  event: EventAppSubject;
  items: readonly TabItem[];
  activeId: string;
}) {
  const live = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(event.slug)}`, eventDetailResponseSchema),
    [event.slug],
  );
  return (
    <ParticipantEventNavigation
      event={live.data ? participantEventAppSubject(live.data.event) : event}
      items={items}
      activeId={activeId}
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
