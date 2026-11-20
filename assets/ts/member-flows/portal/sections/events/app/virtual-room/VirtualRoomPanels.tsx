/**
 * What the virtual room shows around its stream: the session's reactions, its questions and polls, its chat,
 * and "Now & next" in this location. The three live parts share one connection to the session's room.
 */
import { eventSessionRoute } from "../../../../../../../shared/event-participation-link";
import { LiveChatClosed } from "../../../../../../live-session/LiveChat";
import { useLiveParticipation } from "../../../../../../live-session/LiveParticipationAlert";
import { LiveReactionBar } from "../../../../../../live-session/LiveReactionBar";
import { LiveAttendeeChat } from "../../../../../../live-session/SessionChat";
import { LiveAttendeeQuestions, LiveQuestionsClosed } from "../../../../../../live-session/SessionQuestions";
import { useLiveRoom, type LiveRoomConnection } from "../../../../../../live-session/useLiveRoom";
import { useLiveWindow } from "../../../../../../live-session/useLiveWindow";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { usePortalHashLocation } from "../../../../hash-location";
import { sessionSpeakerLine, type RoomMoment, type RoomSession } from "./virtual-room-schedule";

function ScheduleItem({
  slug,
  session,
  live,
  formatTime,
}: {
  slug: string;
  session: RoomSession;
  live: boolean;
  formatTime: (startAt: string, endAt: string) => string;
}) {
  const speakers = sessionSpeakerLine(session);
  return (
    <li class="pk-virtual-room__item">
      <span class="pk-event-card__meta">
        {live ? "Now · " : ""}
        {formatTime(session.startAt, session.endAt)}
      </span>
      <a class="pk-strong" href={usePortalHashLocation.hrefs(eventSessionRoute(slug, session.id))}>
        {session.title}
      </a>
      {speakers && <span class="pk-event-card__meta">{speakers}</span>}
    </li>
  );
}

/** The location's running session and the ones after it. */
export function VirtualRoomSchedule({
  slug,
  moment,
  formatTime,
}: {
  slug: string;
  moment: RoomMoment;
  formatTime: (startAt: string, endAt: string) => string;
}) {
  const sessions = [...(moment.current ? [moment.current] : []), ...moment.upcoming];
  if (!sessions.length)
    return <EmptyState title="Nothing more here today" body="Sessions in this location appear here as they near." />;
  return (
    <ol class="pk-plain-list pk-stack pk-stack--snug" aria-label="Sessions in this room">
      {sessions.map((session) => (
        <ScheduleItem
          key={session.id}
          slug={slug}
          session={session}
          live={session === moment.current}
          formatTime={formatTime}
        />
      ))}
    </ol>
  );
}

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
export function VirtualRoomQuestions({ live }: { live: RoomLive }) {
  if (!live.session || !live.open) return <LiveQuestionsClosed />;
  return <LiveAttendeeQuestions room={live.room} occurrenceId={live.session.id} />;
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
