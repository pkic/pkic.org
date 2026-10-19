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
import { participantEventAppSubject, type EventAppSubject } from "./app/event-app-tabs";
import "./ParticipantEventNavigation.css";

type ScannerAccess = z.infer<typeof eventScannerAccessSchema>;

export function ParticipantEventNavigation({
  event,
  items,
  activeId,
}: {
  event: EventAppSubject;
  items: readonly TabItem[];
  activeId: string;
}) {
  const access = participantScannerAccess(event.id, event.scannerAccess);
  const base = `/events/${encodeURIComponent(event.slug)}`;
  return (
    <>
      {/* Desktop and tablets: the page's own top tabs. Phones: the event app's bottom bar. */}
      <Tabs
        class="pk-participant-event__navigation"
        label="Event"
        activeId={activeId}
        items={[
          ...items,
          // The open scanner stays named in its own navigation; its route authorized it already.
          ...(access.canScan || activeId === "scanner"
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
      <EventAppBar event={event} activeId={activeId} />
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
