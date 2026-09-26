import { usePortalHashLocation } from "../../hash-location";
import type { EventAudienceDetail } from "../../../../../shared/schemas/event-management";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { formatDateRange } from "../../ui";
import { ViewerEventState } from "./ViewerEventState";

/** A session-safe event detail for readers without event management permission. */
export function EventAudienceView({ event }: { event: EventAudienceDetail }) {
  return (
    <div class="pk-stack">
      <PageHeader
        title={event.name}
        trail={[{ label: "Events", href: usePortalHashLocation.hrefs("/events") }, { label: event.name }]}
      />
      <Panel>
        <PanelHeader title="Event details" />
        <PanelBody>
          <DescriptionList
            items={[
              { term: "When", value: formatDateRange(event.startsAt, event.endsAt, event.timezone) },
              { term: "Location", value: event.location ?? "Not specified" },
            ]}
          />
          {event.basePath && <a href={event.basePath}>Public event information</a>}
        </PanelBody>
      </Panel>
      {event.viewer ? (
        <Panel>
          <PanelHeader title="Your registration" />
          <PanelBody>
            <ViewerEventState viewer={event.viewer} />
          </PanelBody>
        </Panel>
      ) : event.registrationPath ? (
        <Panel>
          <PanelHeader title="Registration" />
          <PanelBody>
            <a href={event.registrationPath}>Register for this event</a>
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}
