import { useBoundaryClock } from "../../../../hooks/useBoundaryClock";
import type { ComponentChildren } from "preact";
import type { z } from "zod";
import type { eventsListResponseSchema } from "../../../../../shared/schemas/event-management";
import { eventPhase } from "../../../../../shared/event-phase";
import { eventClock } from "../../../../../shared/event-clock";
import { formatEventPlace } from "../../../../../shared/event-place";
import { CollectionStatusLine } from "../../../../ui/CollectionCard";
import { EventCard } from "../../../../site/EventCard";
import { useSectionHeading, type HeadingLevel } from "../../../../ui/HeadingOutline";
import { formatEventWhen, formatDateRange } from "../../ui";
import { eventDestination } from "./event-destination";
import { eventViewerStatus } from "./event-viewer-status";
import "../DiscoveryView.css";

type EventRow = z.infer<typeof eventsListResponseSchema>["events"][number];

export function eventWhen(event: EventRow): string {
  return formatEventWhen(event.startsAt, eventClock(event), null, null);
}

/** Public and portal discovery share the website's photo-overlay card. */
export function EventCollectionCard({
  event,
  actions,
  headingLevel = 3,
}: {
  event: EventRow;
  actions?: ComponentChildren;
  headingLevel?: HeadingLevel;
}) {
  const Heading = useSectionHeading(headingLevel);
  const now = useBoundaryClock((at) => {
    for (const stamp of [event.startsAt, event.endsAt]) {
      if (stamp && Date.parse(stamp) > at) {
        // A date-based badge enters its six-month window at a UTC day boundary.
        const nextDay = new Date(at);
        nextDay.setUTCHours(24, 0, 0, 0);
        return Math.min(Date.parse(stamp), nextDay.getTime());
      }
    }
    return null;
  });
  const standing = eventViewerStatus(event);
  const place = formatEventPlace(event);
  return (
    <EventCard
      heading={Heading}
      phase={eventPhase(event, now)}
      item={{
        title: event.name,
        date: event.startsAt ?? undefined,
        href: eventDestination(event),
        imageSrc: event.heroImageUrl ?? undefined,
        location: [event.startsAt ? formatDateRange(event.startsAt, event.endsAt, event.timezone) : null, place]
          .filter(Boolean)
          .join(" · "),
      }}
    >
      {(standing.length > 0 || actions) && (
        <div class="pk-cluster pk-cluster--between">
          {standing.length > 0 && (
            <div role="group" aria-label="Your status">
              <CollectionStatusLine items={standing} />
            </div>
          )}
          {actions}
        </div>
      )}
    </EventCard>
  );
}
