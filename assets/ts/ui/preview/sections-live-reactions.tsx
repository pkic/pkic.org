/**
 * Live reactions on the livestream overlay, driven by a scripted audience so
 * a still picture shows how the lane and the crowd count read on air.
 */
import { useEffect, useState } from "preact/hooks";
import type { LiveReactionId } from "../../../shared/live-session-policy";
import { LiveOverlayPresentation } from "../../live-session/LiveOverlayPresentation";
import type { LiveRoomState } from "../../live-session/live-room-state";
import { sampleOverlayRoom } from "../../member-flows/portal/sections/events/detail/settings/live-layouts/overlay-layout-sample";
import type { PreviewSection } from "./PreviewShell";
import "./event-screens-preview.css";

type Counts = Partial<Record<LiveReactionId, number>>;
/** One broadcast the room sends: who joined, and how many people react in the window. */
type Step = { counts: Counts; people: Counts };

const NOW = Date.parse("2026-11-17T15:00:00.000Z");
const ROOM = sampleOverlayRoom(NOW);
const STAGE = {
  ...ROOM.stage,
  question: null,
  poll: null,
  ticker: null,
  panelists: null,
  schedule: null,
  checkIn: null,
  timerGraphics: [],
  topQuestions: null,
  chatFeed: null,
  reactions: true,
  reactionsGraphic: { showCount: true },
};

/** One person clicking again and again: one join, then repeats that add nothing on air. */
const ONE_PERSON: Step[] = [
  { counts: { applause: 1 }, people: { applause: 1 } },
  ...Array.from({ length: 5 }, () => ({ counts: {}, people: { applause: 1 } })),
];

/** People joining one by one until `applause` and `thumbs_up` reach their totals. */
function crowd(applause: number, thumbsUp: number): Step[] {
  const steps: Step[] = [];
  let clapping = 0;
  let liking = 0;
  while (clapping < applause || liking < thumbsUp) {
    const counts: Counts = {};
    // Thumbs up joins in proportion, so both rise together.
    if (clapping < applause) counts.applause = Math.min(applause - clapping, Math.ceil(applause / 8));
    if (liking < thumbsUp && liking * applause <= clapping * thumbsUp)
      counts.thumbs_up = Math.min(thumbsUp - liking, Math.ceil(thumbsUp / 8));
    clapping += counts.applause ?? 0;
    liking += counts.thumbs_up ?? 0;
    steps.push({ counts, people: { applause: clapping, ...(liking ? { thumbs_up: liking } : {}) } });
  }
  return steps;
}

/** Plays the steps one broadcast at a time, then keeps the same people reacting without anyone new joining. */
function ScriptedAudience({ steps }: { steps: readonly Step[] }) {
  const [sequence, setSequence] = useState(0);
  useEffect(() => {
    const next = setInterval(() => setSequence((value) => value + 1), 350);
    return () => clearInterval(next);
  }, []);
  const step = steps[sequence - 1] ?? { counts: {}, people: steps.at(-1)!.people };
  const state: LiveRoomState = { ...ROOM, stage: STAGE, burst: sequence ? { sequence, ...step } : null };
  return (
    <div class="pk-preview__screen pk-preview__camera">
      <LiveOverlayPresentation view="program" projection={state} broadcast />
    </div>
  );
}

export const liveReactionsSections: PreviewSection[] = [
  {
    id: "live-reactions-one-person",
    title: "Reactions on air: one person clicking",
    note: "Repeat clicks add nothing on air: one faint float, no count.",
    render: () => <ScriptedAudience steps={ONE_PERSON} />,
  },
  {
    id: "live-reactions-six-people",
    title: "Reactions on air: six people",
    note: "Five people applaud and one gives a thumbs up within ten seconds: a few floats and a small count from five people.",
    render: () => <ScriptedAudience steps={crowd(5, 1)} />,
  },
  {
    id: "live-reactions-forty-people",
    title: "Reactions on air: forty people",
    note: "The floats stay capped and faint; the count carries the size of the crowd.",
    render: () => <ScriptedAudience steps={crowd(31, 9)} />,
  },
];
