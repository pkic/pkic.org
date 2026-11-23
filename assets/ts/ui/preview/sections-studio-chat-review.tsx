/** The studio chat's Review tab: what the check removed or flagged and what people reported, decided on the row. */
import { useEffect } from "preact/hooks";
import type { LiveChatMessage } from "../../../shared/schemas/live-session-chat";
import { LiveChatPanel } from "../../member-flows/portal/sections/events/detail/live/LiveChatPanel";
import type { LiveChatView } from "../../live-session/location-chat-state";
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
    hidden: { operatorName: "Automatic check", at: at(14) },
    automaticCheck: {
      outcome: "blocked",
      notes: ["Sales pitches aren't allowed in the chat."],
      flags: [{ id: "solicitation", percent: 96 }],
    },
  }),
  message(2, "Riley Example", "That migration plan is naive. Nobody rotates roots in six months.", 12, {
    automaticCheck: {
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
    hidden: { operatorName: "Automatic check", at: at(6) },
    automaticCheck: {
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

export const studioChatReviewSections: PreviewSection[] = [
  {
    id: "studio-chat-review",
    title: "Studio chat: review",
    note: "What the check removed or flagged and what people reported, in one queue. Removed messages lead, since their authors are waiting on a decision. Each row shows the words and, on its own line, why it is here; the tag's tooltip has every score. The menu opens on Keep and Hide, then pause and block.",
    render: () => <ReviewSpecimen />,
  },
];
