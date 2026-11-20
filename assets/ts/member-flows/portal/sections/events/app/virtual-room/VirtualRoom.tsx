import {
  agendaMediaCapabilities,
  agendaOccurrenceMedia,
  ONLINE_JOIN_LEAD_MS,
} from "../../../../../../../shared/event-agenda-media";
/**
 * The event app's virtual room: one location's live stream with the running session and the event's
 * sponsors, the session's questions, polls and chat, and what is on next. `VirtualRoomFrame` lays it out for
 * a desktop and for a phone. The viewer switches location in place; each location has its own address.
 *
 * Streams come from the attendee endpoint, which releases them only to registered attendees and staff; the
 * running session comes from the published agenda compared with the browser clock at session boundaries.
 */
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useRef } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { agendaTimeZones } from "../../../../../../../shared/agenda-time-display";
import { eventVirtualRoomRoute } from "../../../../../../../shared/event-participation-link";
import { formatDateTimeWithSchedule, formatTimeRangeInZone } from "../../../../../../../shared/format-date";
import { locationStreamOn, virtualRoomResponseSchema } from "../../../../../../../shared/schemas/event-live-stream";
import { instantToCalendarDate, viewerTimeZone } from "../../../../../../../shared/timezone";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { useBoundaryClock } from "../../../../../../hooks/useBoundaryClock";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { Alert } from "../../../../../../ui/Alert";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { useMediaQuery } from "../../../../../../hooks/useMediaQuery";
import { useSponsorDisplay } from "../../../../../sponsors-wall-data";
import { usePortalHashLocation } from "../../../../hash-location";
import { useAgendaProgram, type AgendaProgram } from "../../detail/participation/useAgendaProgram";
import { ROOM_PANELS, ROOM_WIDE_QUERY, VirtualRoomFrame, type RoomPanelId } from "./VirtualRoomFrame";
import { VirtualRoomChat, VirtualRoomQuestions, VirtualRoomReactions, useRoomLive } from "./VirtualRoomPanels";
import { VirtualRoomPartners } from "./VirtualRoomPartners";
import { VirtualRoomSponsors } from "./VirtualRoomSponsors";
import { VirtualRoomNowPlaying, VirtualRoomPlayer } from "./VirtualRoomPlayer";
import {
  chooseLocation,
  locationSessions,
  nextRoomBoundary,
  requestedSessionNotice,
  roomMoment,
} from "./virtual-room-schedule";
import "../EventApp.css";
import "./VirtualRoom.css";

function useVirtualRoomData(slug: string) {
  const base = `/api/v1/events/${encodeURIComponent(slug)}/agenda`;
  const streams = useData(() => getJson(`${base}/streams`, virtualRoomResponseSchema), [slug]);
  return { streams, program: useAgendaProgram(slug) };
}

export function VirtualRoom({
  slug,
  agenda: agendaView,
}: {
  slug: string;
  /**
   * The event's own agenda, under the stream on a desktop and on a phone's Agenda tab. It takes the program
   * the room has read already, so showing it asks the server for nothing.
   */
  agenda: (program: AgendaProgram) => ComponentChildren;
}) {
  const [location, navigate] = useHashLocation();
  const wide = useMediaQuery(ROOM_WIDE_QUERY);
  const query = new URLSearchParams(location.split("?", 2)[1] ?? "");
  const { streams, program } = useVirtualRoomData(slug);
  const sponsors = useSponsorDisplay("/api/v1", { eventSlug: slug });
  const agenda = program.data?.agenda ?? null;
  const locations = useMemo(() => {
    const configured = streams.data?.locations ?? [];
    if (!agenda) return configured;
    const waiting = agenda.rooms
      .filter(
        (room) =>
          !configured.some((item) => item.id === room.id) &&
          (agendaMediaCapabilities(room.equipment).liveStreaming ||
            agenda.occurrences.some(
              (session) => session.roomId === room.id && agendaOccurrenceMedia(agenda.rooms, session).liveStreaming,
            )),
      )
      .map((room) => ({ id: room.id, name: room.name, stream: null, days: [] }));
    return [...configured, ...waiting];
  }, [streams.data, agenda]);
  const roomId = chooseLocation(locations, agenda, { room: query.get("room"), session: query.get("session") });
  const room = locations.find((candidate) => candidate.id === roomId) ?? null;
  const timeZone = streams.data?.timeZone ?? agenda?.timeZone ?? "UTC";
  const sessions = useMemo(() => (agenda && roomId ? locationSessions(agenda, roomId) : []), [agenda, roomId]);
  const now = useBoundaryClock(
    useCallback((at: number) => nextRoomBoundary(sessions, at, timeZone), [sessions, timeZone]),
  );
  // While a session is on, a phone opens on its questions; between sessions on the agenda.
  const moment = roomMoment(sessions, now);
  const live = useRoomLive(slug, moment);
  const defaultPanel: RoomPanelId = moment.current ? "questions" : "agenda";
  const [panel, setPanel] = useHashQueryParam("roomPanel", defaultPanel, ROOM_PANELS);
  const startsAt = sessions[0]?.startAt;
  const waiting = Boolean(startsAt && now < Date.parse(startsAt) - ONLINE_JOIN_LEAD_MS);
  const previousCountdown = useRef({ roomId, waiting });
  const reloadStreams = streams.reload;
  useEffect(() => {
    const previous = previousCountdown.current;
    previousCountdown.current = { roomId, waiting };
    if (previous.roomId === roomId && previous.waiting && !waiting) void reloadStreams();
  }, [roomId, waiting, reloadStreams]);
  if (streams.loading || program.loading) return <Spinner label="Opening the virtual room…" />;
  if (streams.error) return <ErrorAlert error={streams.error} />;
  if (!room)
    return (
      <EmptyState
        title="No virtual locations are scheduled"
        body="Check the agenda for this event’s online sessions."
      />
    );
  const stream = locationStreamOn(room, instantToCalendarDate(new Date(now).toISOString(), timeZone));
  const viewerZone = agendaTimeZones(timeZone, viewerTimeZone(), "remote").primary.zone;
  const formatTime = (startAt: string, endAt: string) => formatTimeRangeInZone(startAt, endAt, viewerZone);
  const requested = requestedSessionNotice(agenda, query.get("session"), now);
  const href = usePortalHashLocation.hrefs;
  const onAir = Boolean(moment.current && stream && !waiting);
  return (
    <>
      {program.error && <ErrorAlert error={program.error} />}
      <VirtualRoomFrame
        wide={wide}
        notice={
          requested && (
            <Alert
              title={
                requested.state === "ended"
                  ? `${requested.session.title} has ended`
                  : `${requested.session.title} starts ${formatDateTimeWithSchedule(requested.session.startAt, timeZone)}`
              }
            >
              {requested.state === "ended"
                ? `Below is what is on in ${room.name} now.`
                : `Until then, below is what is on in ${room.name}.`}
            </Alert>
          )
        }
        locations={locations.map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          href: href(eventVirtualRoomRoute(slug, { room: candidate.id })),
        }))}
        locationId={room.id}
        onLocation={(id) => navigate(eventVirtualRoomRoute(slug, { room: id }))}
        player={
          <VirtualRoomPlayer
            stream={waiting ? null : stream}
            locationName={room.name}
            startsAt={waiting ? startsAt : undefined}
          />
        }
        now={(picker) => (
          <VirtualRoomNowPlaying
            slug={slug}
            moment={moment}
            formatTime={formatTime}
            location={picker}
            reactions={onAir ? <VirtualRoomReactions live={live} /> : null}
          />
        )}
        sponsors={<VirtualRoomSponsors sponsors={sponsors.display} />}
        partners={<VirtualRoomPartners partners={streams.data?.productionPartners ?? []} />}
        questions={(askIn) => <VirtualRoomQuestions live={live} askIn={askIn} />}
        chat={<VirtualRoomChat live={live} />}
        agenda={agendaView(program)}
        eventHref={href(`/events/${encodeURIComponent(slug)}`)}
        panel={panel}
        panelHref={(id) => href(panelRoute(location, id, defaultPanel))}
        onPanel={setPanel}
      />
    </>
  );
}

/** The open page's address with another room panel chosen; the panel a room opens on stays out of it. */
function panelRoute(location: string, panel: RoomPanelId, defaultPanel: RoomPanelId): string {
  const [path, search = ""] = location.split("?", 2);
  const query = new URLSearchParams(search);
  if (panel === defaultPanel) query.delete("roomPanel");
  else query.set("roomPanel", panel);
  return query.size ? `${path}?${query}` : path!;
}
