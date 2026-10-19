/**
 * The event app's virtual room: one location's live stream, large, with what is on now and next, the
 * session's questions and the event's sponsors beside it (below it on a phone, under a player that stays in
 * view). The viewer switches location by its tab; each location has its own address.
 *
 * Streams come from the attendee endpoint, which releases them only to registered attendees and staff; the
 * running session comes from the published agenda compared with the browser clock at session boundaries.
 */
import { useCallback, useMemo } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { agendaTimeZones } from "../../../../../../../shared/agenda-time-display";
import { eventVirtualRoomRoute } from "../../../../../../../shared/event-participation-link";
import { formatTimeRangeInZone } from "../../../../../../../shared/format-date";
import { locationStreamOn, virtualRoomResponseSchema } from "../../../../../../../shared/schemas/event-live-stream";
import { personalAgendaProgramResponseSchema } from "../../../../../../../shared/schemas/event-personal-agenda";
import { instantToCalendarDate, viewerTimeZone } from "../../../../../../../shared/timezone";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { useBoundaryClock } from "../../../../../../hooks/useBoundaryClock";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { Tabs } from "../../../../../../ui/Tabs";
import { useSponsorDisplay } from "../../../../../sponsors-wall-data";
import { usePortalHashLocation } from "../../../../hash-location";
import { VirtualRoomPanels } from "./VirtualRoomPanels";
import { VirtualRoomNowPlaying, VirtualRoomPlayer } from "./VirtualRoomPlayer";
import { chooseLocation, locationSessions, nextRoomBoundary, roomMoment } from "./virtual-room-schedule";
import "../EventApp.css";
import "./VirtualRoom.css";

function useVirtualRoomData(slug: string) {
  const base = `/api/v1/events/${encodeURIComponent(slug)}/agenda`;
  const streams = useData(() => getJson(`${base}/streams`, virtualRoomResponseSchema), [slug]);
  const program = useData(() => getJson(`${base}/participation/program`, personalAgendaProgramResponseSchema), [slug]);
  return { streams, program };
}

export function VirtualRoom({ slug, eventName }: { slug: string; eventName: string }) {
  const [location] = useHashLocation();
  const query = new URLSearchParams(location.split("?", 2)[1] ?? "");
  const { streams, program } = useVirtualRoomData(slug);
  const sponsors = useSponsorDisplay("/api/v1", { eventSlug: slug });
  const agenda = program.data?.agenda ?? null;
  const locations = streams.data?.locations ?? [];
  const roomId = chooseLocation(locations, agenda, { room: query.get("room"), session: query.get("session") });
  const room = locations.find((candidate) => candidate.id === roomId) ?? null;
  const timeZone = streams.data?.timeZone ?? agenda?.timeZone ?? "UTC";
  const sessions = useMemo(() => (agenda && roomId ? locationSessions(agenda, roomId) : []), [agenda, roomId]);
  const now = useBoundaryClock(
    useCallback((at: number) => nextRoomBoundary(sessions, at, timeZone), [sessions, timeZone]),
  );
  if (streams.loading || program.loading) return <Spinner label="Opening the virtual room…" />;
  if (streams.error) return <ErrorAlert error={streams.error} />;
  if (!room)
    return (
      <EmptyState
        title="No live streams yet"
        body="Live streams appear here when the organizers start broadcasting a location."
      />
    );
  const stream = locationStreamOn(room, instantToCalendarDate(new Date(now).toISOString(), timeZone));
  const moment = roomMoment(sessions, now, timeZone);
  const viewerZone = agendaTimeZones(timeZone, viewerTimeZone(), "remote").primary.zone;
  const formatTime = (startAt: string, endAt: string) => formatTimeRangeInZone(startAt, endAt, viewerZone);
  return (
    <div class="pk-virtual-room">
      {locations.length > 1 && (
        <Tabs
          class="pk-virtual-room__locations"
          label="Locations"
          activeId={room.id}
          items={locations.map((candidate) => ({
            id: candidate.id,
            label: candidate.name,
            href: usePortalHashLocation.hrefs(eventVirtualRoomRoute(slug, { room: candidate.id })),
          }))}
        />
      )}
      <div class="pk-virtual-room__stage">
        <VirtualRoomPlayer stream={stream} locationName={room.name} />
        <VirtualRoomNowPlaying slug={slug} moment={moment} stream={stream} formatTime={formatTime} />
      </div>
      {program.error && <ErrorAlert error={program.error} />}
      <VirtualRoomPanels
        slug={slug}
        eventName={eventName}
        moment={moment}
        sponsors={sponsors.display}
        formatTime={formatTime}
      />
    </div>
  );
}
