/**
 * What the virtual room shows around its stream of the session it is on: its reactions, its questions and
 * polls, and its chat. The three share one connection to the session's room.
 */
import { LiveChatClosed } from "../../../../../../live-session/LiveChat";
import { useLiveParticipation } from "../../../../../../live-session/LiveParticipationAlert";
import { LiveReactionBar } from "../../../../../../live-session/LiveReactionBar";
import { LiveAttendeeChat } from "../../../../../../live-session/SessionChat";
import { LiveAttendeeQuestions, LiveQuestionsClosed } from "../../../../../../live-session/SessionQuestions";
import { useLiveRoom, type LiveRoomConnection } from "../../../../../../live-session/useLiveRoom";
import { useLiveWindow } from "../../../../../../live-session/useLiveWindow";
import type { RoomMoment, RoomSession } from "./virtual-room-schedule";

/** The room's one live connection: the session it follows, whether its room is open, and the room itself. */
export interface RoomLive {
  /** The session running in the location, or the next one, whose room may already be open. */
  session: RoomSession | null;
  /** Whether that session's room takes attendees now, from shortly before its start until after its end. */
  open: boolean;
  room: LiveRoomConnection;
}

/**
 * One connection to the live room of the session the location is on, shared by the reactions, the questions
 * and the chat, so a viewer holds one however many of them are on screen.
 */
export function useRoomLive(slug: string, moment: RoomMoment): RoomLive {
  const session = moment.current ?? moment.upcoming[0] ?? null;
  const open = useLiveWindow(session?.startAt ?? "", session?.endAt ?? "") && Boolean(session);
  const connection = useLiveRoom({ slug, occurrenceId: session?.id ?? "", enabled: open });
  // What the previous session's room last said is not this session's: until this one answers, there is none.
  const stale = connection.state && connection.state.session.occurrenceId !== session?.id;
  return { session, open, room: stale ? { ...connection, state: null } : connection };
}

/** The questions and polls of the session the location is on. */
export function VirtualRoomQuestions({ live, askIn }: { live: RoomLive; askIn: HTMLElement | null }) {
  if (!live.session || !live.open) return <LiveQuestionsClosed askIn={askIn} />;
  return <LiveAttendeeQuestions room={live.room} occurrenceId={live.session.id} askIn={askIn} />;
}

/** The chat of the session the location is on, in a window that fills its panel. */
export function VirtualRoomChat({ live }: { live: RoomLive }) {
  if (!live.session || !live.open) return <LiveChatClosed />;
  return <LiveAttendeeChat room={live.room} compact />;
}

/** The reaction bar, while the session is on air and the viewer may take part. */
export function VirtualRoomReactions({ live }: { live: RoomLive }) {
  const state = live.room.state;
  const restriction = useLiveParticipation(state?.viewer.participation);
  if (!live.open || !state || restriction) return null;
  return <LiveReactionBar send={live.room.send} refusal={state.refusal} disabled={live.room.status !== "live"} />;
}
