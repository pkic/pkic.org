import { SessionChat } from "../../../../../../live-session/SessionChat";
import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
/**
 * The virtual room's side panels: "Now & next" in this location, the live "Questions", and the event's
 * "Sponsors". Chat uses the same canonical session window and authenticated live room as questions.
 */
import { eventSessionRoute } from "../../../../../../../shared/event-participation-link";
import type { SponsorsDisplayResponse } from "../../../../../../../shared/schemas/public-sponsors";
import { SponsorGridView } from "../../../../../../site/SponsorDisplays";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { TabList } from "../../../../../../ui/TabList";
import { usePortalHashLocation } from "../../../../hash-location";
import { SessionQuestionsSlot } from "./SessionQuestionsSlot";
import { sessionSpeakerLine, type RoomMoment, type RoomSession } from "./virtual-room-schedule";

type PanelId = "schedule" | "questions" | "chat" | "sponsors";

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
  eventName,
  moment,
  sponsors,
  formatTime,
}: {
  slug: string;
  eventName: string;
  moment: RoomMoment;
  sponsors: SponsorsDisplayResponse | null;
  formatTime: (startAt: string, endAt: string) => string;
}) {
  const [active, setActive] = useHashQueryParam("roomPanel", "schedule", [
    "schedule",
    "questions",
    "chat",
    "sponsors",
  ] as const);
  const hasSponsors = Boolean(sponsors?.groups.some((group) => group.sponsors.some((sponsor) => sponsor.logoUrl)));
  const items = [
    { id: "schedule" as const, label: "Now & next" },
    { id: "questions" as const, label: "Questions" },
    { id: "chat" as const, label: "Chat" },
    ...(hasSponsors ? [{ id: "sponsors" as const, label: "Sponsors" }] : []),
  ].map((item) => ({ ...item, panelId: `virtual-room-${item.id}` }));
  const shown = items.some((item) => item.id === active) ? active : "schedule";
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
        {shown === "sponsors" && sponsors && <SponsorGridView display={sponsors} eventName={eventName} rows={false} />}
      </div>
    </section>
  );
}
