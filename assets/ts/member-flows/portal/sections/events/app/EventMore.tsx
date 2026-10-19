/**
 * The event app's "More" page: the venue, the event's links, and every
 * destination without a bottom tab — the same tiles the More sheet shows, for
 * a deep link or a reader without the bottom bar. Entries appear only when
 * the reader can open them.
 */
import { LinkList } from "../../../../../ui/LinkList";
import { portalSession } from "../../../state";
import { EventAppDestinations } from "./EventAppDestinations";
import { EventCard } from "./EventCard";
import { eventAppNavigation, participantEventAppSubject } from "./event-app-tabs";
import { eventVenueLines, type ParticipantEventDetail } from "./event-app-model";

export function EventMore({ event }: { event: ParticipantEventDetail }) {
  // The venue tile opens this page, which shows the venue itself.
  const destinations = eventAppNavigation(participantEventAppSubject(event), portalSession.value).more.filter(
    (destination) => destination.id !== "venue",
  );
  const venue = eventVenueLines(event);
  return (
    <div class="pk-stack">
      {venue.length > 0 && (
        <EventCard eyebrow="Venue">
          <address class="pk-event-venue pk-stack pk-stack--tight">
            {venue.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </address>
        </EventCard>
      )}
      {event.links.length > 0 && (
        <EventCard eyebrow="Event links">
          <LinkList links={event.links} label="Event links" />
        </EventCard>
      )}
      <EventCard eyebrow="More for this event">
        {destinations.length ? (
          <EventAppDestinations destinations={destinations} label="More event pages" />
        ) : (
          <p>Nothing else is available for this event yet.</p>
        )}
      </EventCard>
    </div>
  );
}
