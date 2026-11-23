import { ONLINE_JOIN_LEAD_MS } from "../../../../../../../shared/event-agenda-media";
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
import { ProductionPartners } from "../../../../../../site/ProductionPartners";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import { useMediaQuery } from "../../../../../../hooks/useMediaQuery";
import { useSponsorDisplay } from "../../../../../sponsors-wall-data";
import { usePortalHashLocation } from "../../../../hash-location";
import { useAgendaProgram, type AgendaProgram } from "../../detail/participation/useAgendaProgram";
import { ROOM_PANELS, ROOM_WIDE_QUERY, VirtualRoomFrame, type RoomPanelId } from "./VirtualRoomFrame";
import { VirtualRoomChat, VirtualRoomQuestions, VirtualRoomReactions, useRoomLive } from "./VirtualRoomPanels";
import { useLocationChat } from "../../../../../../live-session/useLocationChat";
import { VirtualRoomSponsors } from "./VirtualRoomSponsors";
import { sessionStartsIn, VirtualRoomInRoom, VirtualRoomNowPlaying, VirtualRoomPlayer } from "./VirtualRoomPlayer";
import {
  chooseLocation,
  locationSessions,
  nextRoomBoundary,
  requestedSessionNotice,
  roomLocations,
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
  away = false,
  motifUrl = null,
  agenda: agendaView,
}: {
  slug: string;
  /** The event's own artwork, along the foot of a location held in the room only, as in the event's header. */
  motifUrl?: string | null;
  /**
   * The attendee is on another page of the event: the room stays connected, so coming back shows it at once,
   * with no stream playing and the address it had when they left.
   */
  away?: boolean;
  /**
   * The event's own agenda, under the stream on a desktop and on a phone's Agenda tab. It takes the program
   * the room has read already, so showing it asks the server for nothing. It opens on the location in view.
   */
  agenda: (program: AgendaProgram, locationId: string | null) => ComponentChildren;
}) {
  const [current] = useHashLocation();
  const shown = useRef(current);
  if (!away) shown.current = current;
  const location = shown.current;
  const wide = useMediaQuery(ROOM_WIDE_QUERY);
  const query = new URLSearchParams(location.split("?", 2)[1] ?? "");
  // Back from another page of the event, the room opens on the location the attendee left.
  const lastRoom = useRef<string | null>(null);
  const { streams, program } = useVirtualRoomData(slug);
  const sponsors = useSponsorDisplay("/api/v1", { eventSlug: slug });
  const agenda = program.data?.agenda ?? null;
  const locations = useMemo(() => roomLocations(streams.data?.locations ?? [], agenda), [streams.data, agenda]);
  const roomId = chooseLocation(locations, agenda, {
    room: query.get("room") ?? lastRoom.current,
    session: query.get("session"),
  });
  lastRoom.current = roomId;
  const room = locations.find((candidate) => candidate.id === roomId) ?? null;
  const timeZone = streams.data?.timeZone ?? agenda?.timeZone ?? "UTC";
  const sessions = useMemo(() => (agenda && roomId ? locationSessions(agenda, roomId) : []), [agenda, roomId]);
  const now = useBoundaryClock(
    useCallback((at: number) => nextRoomBoundary(sessions, at, timeZone), [sessions, timeZone]),
  );
  // A phone opens where attendees take part: the questions and polls of the session on or next, which take
  // questions ahead of time. Only with no session left does it open on the agenda.
  const viewerZone = agendaTimeZones(timeZone, viewerTimeZone(), "remote").primary.zone;
  // The room follows the session loaded in the studio, which may run over or start early; it says what it is on.
  const live = useRoomLive(slug, roomMoment(sessions, now), sessions, room?.loadedOccurrenceId ?? null, viewerZone);
  const chat = useLocationChat({ slug, roomId: room?.id ?? "" });
  const moment = live.moment;
  const defaultPanel: RoomPanelId = live.session ? "questions" : "agenda";
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
          streamed: candidate.streamed,
        }))}
        locationId={room.id}
        player={
          away ? null : room.streamed ? (
            <VirtualRoomPlayer
              stream={waiting ? null : stream}
              locationName={room.name}
              startsAt={waiting ? startsAt : undefined}
            />
          ) : (
            <VirtualRoomInRoom locationName={room.name} recordingPlanned={room.recordingPlanned} motifUrl={motifUrl} />
          )
        }
        streamed={room.streamed}
        now={(tour) => (
          <VirtualRoomNowPlaying
            slug={slug}
            moment={moment}
            formatTime={formatTime}
            organizations={agenda?.speakerOrganizations}
            tour={tour}
            reactions={onAir ? <VirtualRoomReactions live={live} compact={!wide} /> : null}
            startsIn={(startAt, at) => sessionStartsIn(startAt, at, viewerZone)}
          />
        )}
        sponsors={<VirtualRoomSponsors sponsors={sponsors.display} />}
        partners={<ProductionPartners partners={streams.data?.productionPartners ?? []} />}
        questions={(askIn) => <VirtualRoomQuestions live={live} askIn={askIn} />}
        chat={<VirtualRoomChat chat={chat} zone={viewerZone} />}
        agenda={agendaView(program, roomId)}
        eventHref={href(`/events/${encodeURIComponent(slug)}`)}
        panel={panel}
        panelHref={(id) => href(panelRoute(location, id, defaultPanel))}
        onPanel={setPanel}
        tourOnFirstVisit={!away}
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
