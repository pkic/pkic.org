/**
 * What the virtual room shows around its stream: the reactions, questions and polls of the session it is on,
 * which share one connection to the session's room, and the location's chat for the day on a connection of
 * its own, so a change of session never cuts the conversation off.
 */
import { useEffect, useState } from "preact/hooks";
import type { ClockZone } from "../../../../../../../shared/event-clock";
import { formatClockInZone, formatEventDayInZone } from "../../../../../../../shared/format-date";
import { liveRoomWindow } from "../../../../../../../shared/live-session-policy";
import { LiveChatClosed } from "../../../../../../live-session/LiveChat";
import { useLiveParticipation } from "../../../../../../live-session/LiveParticipationAlert";
import { LiveReactionBar } from "../../../../../../live-session/LiveReactionBar";
import { liveLocationChatOpen, liveLocationChatWindow } from "../../../../../../../shared/live-location-chat";
import { LiveAttendeeChat } from "../../../../../../live-session/LocationChat";
import type { LiveLocationChatConnection } from "../../../../../../live-session/useLocationChat";
import { LiveAttendeeQuestions, LiveQuestionsClosed } from "../../../../../../live-session/SessionQuestions";
import { useLiveRoom, type LiveRoomConnection } from "../../../../../../live-session/useLiveRoom";
import { useLiveWindow, useMinuteClock } from "../../../../../../live-session/useLiveWindow";
import type { RoomMoment, RoomSession } from "./virtual-room-schedule";

/** How long before the room moves on, or the chat closes, attendees read when it does. */
const ENDING_NOTICE_MS = 10 * 60_000;

/** The room's one live connection: the session it is on, whether its room is open, and the room itself. */
export interface RoomLive {
  /** The session the studio has loaded, else the one running in the location or the next one. */
  session: RoomSession | null;
  /** The location's moment as the room shows it: the studio's session is the one running. */
  moment: RoomMoment;
  /** Whether that session takes questions and poll answers now: from when it is scheduled until its room closes. */
  open: boolean;
  /** Whether its chat and reactions are open: from shortly before its start until after its end. */
  live: boolean;
  /** Whether an operator closed the room early. */
  closedEarly: boolean;
  /** When the room moves on from this session, once that is near; null otherwise. */
  endsSoon: string | null;
  room: LiveRoomConnection;
}

/**
 * One connection to the live room of the session the location is on, shared by the reactions, the questions
 * and the chat, so a viewer holds one however many of them are on screen. The room follows the studio: it is
 * on the session loaded there, early or running over, and moves on when the studio loads another. A session
 * the studio left loaded holds the room only until its own room closes on schedule, unless an operator opened
 * it; a location without a loaded session follows the agenda, moving on at each scheduled end.
 */
export function useRoomLive(
  slug: string,
  moment: RoomMoment,
  sessions: readonly RoomSession[],
  loadedId: string | null,
  zone: ClockZone,
): RoomLive {
  const [followed, follow] = useState(loadedId);
  useEffect(() => follow(loadedId), [loadedId]);
  const now = useMinuteClock();
  const studio = sessions.find((session) => session.id === followed) ?? null;
  const scheduled = moment.current ?? moment.upcoming[0] ?? null;
  const [kept, keep] = useState(false);
  const studioCloses = studio ? liveRoomWindow(studio.startAt, studio.endAt).closesAt : -Infinity;
  const session = studio && (now <= studioCloses || kept) ? studio : scheduled;
  const connection = useLiveRoom({ slug, occurrenceId: session?.id ?? "", enabled: Boolean(session) });
  // What the previous session's room last said is not this session's: until this one answers, there is none.
  const state = connection.state?.session.occurrenceId === session?.id ? connection.state : null;
  const opening = state?.opening ?? "scheduled";
  const onStudio = Boolean(studio && session === studio);
  useEffect(() => keep(onStudio && opening === "open"), [onStudio, opening]);
  // The studio went on from its session: so does the room, to the session loaded next or back to the agenda.
  const movedOn = onStudio ? state?.movedOn : null;
  useEffect(() => {
    if (movedOn) follow(movedOn.occurrenceId);
  }, [movedOn]);
  const open = useLiveWindow(session?.startAt ?? "", session?.endAt ?? "", "questions", opening) && Boolean(session);
  const live = useLiveWindow(session?.startAt ?? "", session?.endAt ?? "", "live", opening) && open;
  const movesAt =
    !session || opening !== "scheduled"
      ? Infinity
      : onStudio
        ? studioCloses
        : session === moment.current
          ? Date.parse(session.endAt)
          : Infinity;
  const shown =
    onStudio && studio && studio.id !== moment.current?.id
      ? {
          current: studio,
          upcoming: [moment.current, ...moment.upcoming].filter(
            (next): next is RoomSession => next !== null && next.id !== studio.id,
          ),
        }
      : moment;
  return {
    session,
    moment: shown,
    open,
    live,
    closedEarly: opening === "closed",
    endsSoon:
      movesAt > now && movesAt - now <= ENDING_NOTICE_MS
        ? formatClockInZone(new Date(movesAt).toISOString(), zone)
        : null,
    room: state ? connection : { ...connection, state: null },
  };
}

/** The questions and polls of the session the location is on. */
export function VirtualRoomQuestions({ live, askIn }: { live: RoomLive; askIn: HTMLElement | null }) {
  if (!live.session) return <LiveQuestionsClosed askIn={askIn} note="No session ahead in this location." />;
  if (live.closedEarly) return <LiveQuestionsClosed askIn={askIn} note="The organizers closed questions." />;
  if (!live.open) return <LiveQuestionsClosed askIn={askIn} />;
  return (
    <LiveAttendeeQuestions
      room={live.room}
      occurrenceId={live.session.id}
      askIn={askIn}
      note={live.endsSoon ? `Questions for this session close at ${live.endsSoon}.` : undefined}
    />
  );
}

/**
 * The location's chat for the day, in a window that fills its panel. It opens shortly before the day's first
 * session there and closes a while after its last, whatever the studio does, unless the organizers end it.
 */
export function VirtualRoomChat({ chat, zone }: { chat: LiveLocationChatConnection; zone: ClockZone }) {
  const now = useMinuteClock();
  const state = chat.state;
  if (!state) return <LiveAttendeeChat chat={chat} compact />;
  if (state.opening === "closed") return <LiveChatClosed note="The organizers ended this chat." />;
  const window = liveLocationChatWindow(state.scope.sessions);
  const at = (instant: number) => formatClockInZone(new Date(instant).toISOString(), zone);
  const day = (instant: number) => formatEventDayInZone(new Date(instant).toISOString(), zone);
  if (!window || !liveLocationChatOpen(now, state.scope.sessions, state.opening)) {
    // A chat that opens on a later day says which, so a reader the day before does not wait for it tonight.
    const opens = window && now < window.opensAt ? window.opensAt : null;
    const note =
      opens === null
        ? "Chat has ended for today."
        : day(opens) === day(now)
          ? `Chat opens at ${at(opens)}.`
          : `Chat opens ${day(opens)} at ${at(opens)}.`;
    return <LiveChatClosed note={note} />;
  }
  const closing = state.opening === "scheduled" && window.closesAt - now <= ENDING_NOTICE_MS;
  return <LiveAttendeeChat chat={chat} compact note={closing ? `Chat closes at ${at(window.closesAt)}.` : undefined} />;
}

/** The reaction bar, while the session is on air and the viewer may take part. */
export function VirtualRoomReactions({ live }: { live: RoomLive }) {
  const state = live.room.state;
  const restriction = useLiveParticipation(state?.viewer.participation);
  if (!live.live || !state || restriction) return null;
  return <LiveReactionBar send={live.room.send} refusal={state.refusal} disabled={live.room.status !== "live"} />;
}
