/**
 * The event home's way in for a virtual attendee while something is streamed: the first running session that
 * a location streams, with one action into that location's virtual room, and any others running beside it.
 */
import { eventVirtualRoomRoute } from "../../../../../../../shared/event-participation-link";
import { ButtonLink } from "../../../../../../ui/Button";
import { usePortalHashLocation } from "../../../../hash-location";
import { EventCard } from "../EventCard";
import type { AgendaSession } from "../useEventNow";

function roomHref(slug: string, session: AgendaSession) {
  return usePortalHashLocation.hrefs(
    eventVirtualRoomRoute(slug, { room: session.liveStreamRoomId, session: session.id }),
  );
}

export function WatchLiveCard({ slug, live }: { slug: string; live: readonly AgendaSession[] }) {
  const streamed = live.filter((session) => session.liveStreamRoomId);
  const [first, ...others] = streamed;
  if (!first) return null;
  const roomName = (session: AgendaSession) =>
    session.rooms.find((room) => room.id === session.liveStreamRoomId)?.name ?? null;
  return (
    <EventCard eyebrow="Live now · Watch online" title={first.title} live>
      {roomName(first) && <p class="pk-event-card__meta">{roomName(first)}</p>}
      <div class="pk-cluster">
        <ButtonLink variant="primary" href={roomHref(slug, first)}>
          Watch live
        </ButtonLink>
      </div>
      {others.length > 0 && (
        <ul class="pk-plain-list pk-stack pk-stack--tight" aria-label="Also streaming now">
          {others.map((session) => (
            <li key={session.id}>
              <a href={roomHref(slug, session)}>{session.title}</a>
              {roomName(session) && <span class="pk-event-card__meta"> · {roomName(session)}</span>}
            </li>
          ))}
        </ul>
      )}
    </EventCard>
  );
}
