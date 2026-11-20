/**
 * What the virtual room shows around its stream of the session it is on: its reactions, its questions and
 * polls, and its chat. The three share one connection to the session's room.
 */
import { useEffect, useState } from "preact/hooks";
import type { ClockZone } from "../../../../../../../shared/event-clock";
import { formatClockInZone } from "../../../../../../../shared/format-date";
import { LiveChatClosed } from "../../../../../../live-session/LiveChat";
import { useLiveParticipation } from "../../../../../../live-session/LiveParticipationAlert";
import { LiveReactionBar } from "../../../../../../live-session/LiveReactionBar";
import { LiveAttendeeChat } from "../../../../../../live-session/SessionChat";
import { LiveAttendeeQuestions, LiveQuestionsClosed } from "../../../../../../live-session/SessionQuestions";
import { useLiveRoom, type LiveRoomConnection } from "../../../../../../live-session/useLiveRoom";
import { useLiveWindow, useMinuteClock } from "../../../../../../live-session/useLiveWindow";
import type { RoomMoment, RoomSession } from "./virtual-room-schedule";

/** How long before the room moves on attendees read when this session's chat and questions end. */
const ENDING_NOTICE_MS = 10 * 60_000;

/** The room's one live connection: the session it follows, whether its room is open, and the room itself. */
export interface RoomLive {
  /** The session running in the location, or the next one, whose room may already be open. */
  session: RoomSession | null;
  /** The location's moment as the room shows it: a session its operators keep open stays the one running. */
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
 * and the chat, so a viewer holds one however many of them are on screen. The agenda picks the session, and
 * the room moves on at its scheduled end, unless its operators opened its room: then it stays on it until they
 * hand the room back to the agenda or close it, so a session that runs over keeps its questions and chat.
 */
export function useRoomLive(slug: string, moment: RoomMoment, zone: ClockZone): RoomLive {
  const scheduled = moment.current ?? moment.upcoming[0] ?? null;
  const [held, setHeld] = useState<RoomSession | null>(null);
  const session = held ?? scheduled;
  const connection = useLiveRoom({ slug, occurrenceId: session?.id ?? "", enabled: Boolean(session) });
  // What the previous session's room last said is not this session's: until this one answers, there is none.
  const state = connection.state?.session.occurrenceId === session?.id ? connection.state : null;
  const opening = state?.opening ?? "scheduled";
  useEffect(() => {
    if (opening === "open" && session && held?.id !== session.id) setHeld(session);
    else if (held && state && opening !== "open") setHeld(null);
  }, [opening, session, held, state]);
  const open = useLiveWindow(session?.startAt ?? "", session?.endAt ?? "", "questions", opening) && Boolean(session);
  const live = useLiveWindow(session?.startAt ?? "", session?.endAt ?? "", "live", opening) && open;
  const now = useMinuteClock();
  const ending =
    session && opening === "scheduled" && session === moment.current ? Date.parse(session.endAt) - now : Infinity;
  const shown =
    held && held.id !== moment.current?.id
      ? { current: held, upcoming: [moment.current, ...moment.upcoming].filter((next) => next !== null) }
      : moment;
  return {
    session,
    moment: shown,
    open,
    live,
    closedEarly: opening === "closed",
    endsSoon: session && ending > 0 && ending <= ENDING_NOTICE_MS ? formatClockInZone(session.endAt, zone) : null,
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

/** The chat of the session the location is on, in a window that fills its panel. */
export function VirtualRoomChat({ live }: { live: RoomLive }) {
  if (live.closedEarly) return <LiveChatClosed note="The organizers closed the chat." />;
  if (!live.session || !live.live) return <LiveChatClosed />;
  return (
    <LiveAttendeeChat
      room={live.room}
      compact
      note={live.endsSoon ? `Chat for this session closes at ${live.endsSoon}.` : undefined}
    />
  );
}

/** The reaction bar, while the session is on air and the viewer may take part. */
export function VirtualRoomReactions({ live }: { live: RoomLive }) {
  const state = live.room.state;
  const restriction = useLiveParticipation(state?.viewer.participation);
  if (!live.live || !state || restriction) return null;
  return <LiveReactionBar send={live.room.send} refusal={state.refusal} disabled={live.room.status !== "live"} />;
}
