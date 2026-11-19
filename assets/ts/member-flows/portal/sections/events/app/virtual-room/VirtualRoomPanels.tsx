import { SessionChat } from "../../../../../../live-session/SessionChat";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
/**
 * The virtual room's side panels: the live "Questions", the "Chat", and "Now & next" in this location. Chat
 * uses the same canonical session window and authenticated live room as questions. While a session is on,
 * the panels open on its questions; between sessions they open on what comes next.
 */
import { eventSessionRoute } from "../../../../../../../shared/event-participation-link";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { TabList } from "../../../../../../ui/TabList";
import { usePortalHashLocation } from "../../../../hash-location";
import { SessionQuestionsSlot } from "./SessionQuestionsSlot";
import { sessionSpeakerLine, type RoomMoment, type RoomSession } from "./virtual-room-schedule";

const PANELS = ["questions", "chat", "schedule"] as const;
type PanelId = (typeof PANELS)[number];

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
    <li class={`pk-virtual-room__item${live ? " pk-virtual-room__item--live" : ""}`}>
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

export function VirtualRoomPanels({
  slug,
  moment,
  formatTime,
}: {
  slug: string;
  moment: RoomMoment;
  formatTime: (startAt: string, endAt: string) => string;
}) {
  const [shown, setActive] = useHashQueryParam("roomPanel", moment.current ? "questions" : "schedule", PANELS);
  const items = [
    { id: "questions" as const, label: "Questions" },
    { id: "chat" as const, label: "Chat" },
    { id: "schedule" as const, label: "Now & next" },
  ].map((item) => ({ ...item, panelId: `virtual-room-${item.id}` }));
  const sessions = [...(moment.current ? [moment.current] : []), ...moment.upcoming];
  const interactionSession = moment.current ?? moment.upcoming[0];
  return (
    <section class="pk-virtual-room__panels pk-stack pk-stack--snug" aria-label="In this room">
      <TabList
        label="Room panels"
        idPrefix="virtual-room-tab"
        items={items}
        activeId={shown}
        onSelect={(id) => setActive(id as PanelId)}
      />
      <div id={`virtual-room-${shown}`} role="tabpanel" aria-labelledby={`virtual-room-tab-${shown}`}>
        {shown === "schedule" &&
          (sessions.length ? (
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
          ) : (
            <EmptyState title="Nothing more here today" body="Sessions in this location appear here as they near." />
          ))}
        {shown === "questions" && (
          <SessionQuestionsSlot
            slug={slug}
            session={moment.current}
            next={moment.upcoming[0] ?? null}
            labelledBy="virtual-room-tab-questions"
          />
        )}
        {shown === "chat" &&
          (interactionSession ? (
            <SessionChat
              key={interactionSession.id}
              slug={slug}
              occurrenceId={interactionSession.id}
              startAt={interactionSession.startAt}
              endAt={interactionSession.endAt}
              labelledBy="virtual-room-tab-chat"
              showClosedControls
              closed={
                <EmptyState
                  title="Chat opens when the session is live"
                  body="Talk with other attendees here during the session."
                />
              }
            />
          ) : (
            <EmptyState title="No session chat right now" body="Chat follows the current session in this room." />
          ))}
      </div>
    </section>
  );
}
