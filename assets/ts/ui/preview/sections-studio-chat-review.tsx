/** The studio chat's Review tab: what the check removed or flagged and what people reported, decided on the row. */
import { useEffect } from "preact/hooks";
import type { LiveChatMessage } from "../../../shared/schemas/live-session-chat";
import { LiveChatPanel } from "../../member-flows/portal/sections/events/detail/live/LiveChatPanel";
import type { LiveChatView } from "../../live-session/location-chat-state";
import { LiveChat } from "../../live-session/LiveChat";
import type { PreviewSection } from "./PreviewShell";

const START = "2025-12-01T09:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(START) + minutes * 60_000).toISOString();

const moderation = (overrides: Partial<NonNullable<LiveChatMessage["moderation"]>>) => ({
  hidden: null,
  done: null,
  held: false,
  reports: 0,
  reportReasons: {},
  questionId: null,
  authorStaff: false,
  authorRestriction: null,
  ...overrides,
});

const message = (
  id: number,
  authorName: string,
  text: string,
  minutes: number,
  review: Partial<NonNullable<LiveChatMessage["moderation"]>>,
): LiveChatMessage => ({
  channel: "attendee",
  id: `70000000-0000-4000-8000-00000000000${id}`,
  text,
  authorName,
  mine: false,
  sentAt: at(minutes),
  moderation: moderation(review),
});

const QUEUE: LiveChatMessage[] = [
  message(1, "Sam Sample", "Visit booth 12 for 20% off our HSM appliances", 14, {
    held: true,
    hidden: { operatorName: "Classifier", at: at(14) },
    classifier: {
      outcome: "blocked",
      notes: ["Sales pitches aren't allowed in the chat."],
      flags: [{ id: "solicitation", percent: 96 }],
    },
  }),
  message(2, "Riley Example", "That migration plan is naive. Nobody rotates roots in six months.", 12, {
    classifier: {
      outcome: "advised",
      notes: ["Keep it respectful."],
      flags: [{ id: "conduct", percent: 71 }],
    },
  }),
  message(3, "Jordan Lee", "Check out my channel, like and subscribe", 9, {
    reports: 2,
    reportReasons: { spam: 2 },
  }),
  message(4, "Casey Test", "lol the demo gods were not kind today", 6, {
    held: true,
    hidden: { operatorName: "Classifier", at: at(6) },
    classifier: {
      outcome: "blocked",
      notes: ["Keep it respectful."],
      flags: [{ id: "conduct", percent: 91 }],
    },
    authorRestriction: { block: "paused", until: at(24) },
  }),
];

const STATE: LiveChatView = {
  viewer: { role: "operator", name: "Alex Example" },
  scope: {
    eventName: "PQC Conference",
    roomId: "room-0",
    day: START.slice(0, 10),
    timeZone: "Europe/Amsterdam",
    sessions: [],
  },
  chat: [],
  chatReports: QUEUE,
  refusal: null,
};

function ReviewSpecimen() {
  // The gallery opens the studio chat on its Review tab, as a moderator would after the badge.
  useEffect(() => {
    if (!location.hash.includes("chat=review")) location.hash = "?chat=review";
  }, []);
  return (
    <div class="pk-live-desk__chat-panel">
      <LiveChatPanel state={STATE} disabled={false} send={() => true} studio />
    </div>
  );
}

const EARLIER = "60000000-0000-4000-8000-000000000001";
const NEXT = "60000000-0000-4000-8000-000000000002";
const said = (id: number, authorName: string, text: string, minutes: number): LiveChatMessage => ({
  ...message(id, authorName, text, minutes, {}),
  occurrenceId: EARLIER,
});

/** The studio moved on to the next session and nobody wrote in it yet: the feed ends with its line. */
const SESSION_START: LiveChatView = {
  ...STATE,
  scope: {
    ...STATE.scope,
    sessions: [
      { occurrenceId: EARLIER, title: "Post-quantum migration", startAt: at(0), endAt: at(45) },
      { occurrenceId: NEXT, title: "Hybrid certificates in practice", startAt: at(60), endAt: at(105) },
    ],
  },
  chat: [
    said(5, "Jordan Lee", "Will the slides be shared afterwards?", 38),
    said(6, "Riley Example", "Great talk, thanks!", 44),
  ],
  chatReports: [],
};

/** The Attendees tab's feed on its own, since the gallery's review entry holds the tabs on Review. */
function SessionStartSpecimen() {
  return (
    <div class="pk-live-desk__chat-panel">
      <LiveChat state={SESSION_START} disabled={false} send={() => true} sessionOn={NEXT} compact />
    </div>
  );
}

const PINNED: LiveChatView = {
  ...SESSION_START,
  chat: [
    ...SESSION_START.chat,
    said(7, "Morgan Sample", "Is the hybrid draft stable enough to deploy?", 50),
    said(8, "Taylor Test", "Which libraries support it today?", 52),
  ],
  chatPinned: message(
    9,
    "PKIC Admin",
    "We are having a break until 11:00. Coffee is served in the foyer, and the next session starts in this room.",
    48,
    {},
  ),
};

/** The studio's chat cell as the grid lays it out: a short cell, a long pinned message, the composer at its foot. */
function PinnedSpecimen() {
  return (
    <div data-density="compact" class="pk-preview__studio-cell">
      <section class="pk-studio-panel" aria-label="Chat">
        <header class="pk-studio-panel__header">
          <h3 class="pk-studio-panel__title">Chat</h3>
        </header>
        <div class="pk-studio-panel__body">
          <LiveChatPanel state={PINNED} disabled={false} send={() => true} studio />
        </div>
      </section>
    </div>
  );
}

export const studioChatReviewSections: PreviewSection[] = [
  {
    id: "studio-chat-session-start",
    title: "Studio chat: a new session starts",
    note: "Once the studio loads the next session, the feed ends with its title, as the room does, so the operator sees the messages above belong to the session before. Turn into question on those messages asks it in the session on now.",
    render: () => <SessionStartSpecimen />,
  },
  {
    id: "studio-chat-pinned",
    title: "Studio chat: a pinned message",
    note: "A pinned message takes one line above the feed. Hovering it shows all of it; clicking it keeps it open until clicked again. Only the feed scrolls, so the composer stays at the cell's foot.",
    render: () => <PinnedSpecimen />,
  },
  {
    id: "studio-chat-review",
    title: "Studio chat: review",
    note: "What the classifier removed or flagged and what people reported, in one queue. Removed messages lead, since their authors are waiting on a decision. Each row shows the words and, on its own line, why it is here; the tag's tooltip has every score. The menu opens on Keep and Hide, then pause and block.",
    render: () => <ReviewSpecimen />,
  },
];
