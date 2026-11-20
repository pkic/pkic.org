/**
 * What the virtual room shows around its stream: the session's questions and polls, its chat, and
 * "Now & next" in this location. Chat uses the same canonical session window and authenticated live room
 * as questions.
 */
import { eventSessionRoute } from "../../../../../../../shared/event-participation-link";
import { SessionChat } from "../../../../../../live-session/SessionChat";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { usePortalHashLocation } from "../../../../hash-location";
import { SessionQuestionsSlot } from "./SessionQuestionsSlot";
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

/** The questions and polls of the session running in the location, or of the next one once its room opens. */
export function VirtualRoomQuestions({
  slug,
  moment,
  labelledBy,
}: {
  slug: string;
  moment: RoomMoment;
  labelledBy: string;
}) {
  return (
    <SessionQuestionsSlot
      slug={slug}
      session={moment.current}
      next={moment.upcoming[0] ?? null}
      labelledBy={labelledBy}
    />
  );
}

/** The chat of the session running in the location, or of the next one once its room opens. */
export function VirtualRoomChat({
  slug,
  moment,
  labelledBy,
}: {
  slug: string;
  moment: RoomMoment;
  labelledBy: string;
}) {
  const session = moment.current ?? moment.upcoming[0];
  if (!session)
    return <EmptyState title="No session chat right now" body="Chat follows the current session in this room." />;
  return (
    <SessionChat
      key={session.id}
      slug={slug}
      occurrenceId={session.id}
      startAt={session.startAt}
      endAt={session.endAt}
      labelledBy={labelledBy}
      showClosedControls
      closed={
        <EmptyState
          title="Chat opens when the session is live"
          body="Talk with other attendees here during the session."
        />
      }
    />
  );
}
