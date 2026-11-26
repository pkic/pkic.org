import type {
  LiveOverlayElement,
  LiveOverlayElementPlacement,
  LiveOverlayLayoutElements,
} from "../../shared/schemas/live-overlay-layout";

/**
 * How an output's boards meet the timers over them and each other: the
 * geometry Program's presentation reads. Pure, in fractions of the
 * 1920 x 1080 frame.
 */

const EDGE = 0.001;

/** Whether a box lies within another, allowing for rounding at the edges. */
export function within(inner: LiveOverlayElementPlacement, outer: LiveOverlayElementPlacement) {
  return (
    inner.x >= outer.x - EDGE &&
    inner.y >= outer.y - EDGE &&
    inner.x + inner.w <= outer.x + outer.w + EDGE &&
    inner.y + inner.h <= outer.y + outer.h + EDGE
  );
}

/** Whether two boxes of the frame meet. */
export function meets(one: LiveOverlayElementPlacement, other: LiveOverlayElementPlacement) {
  return one.x < other.x + other.w && one.x + one.w > other.x && one.y < other.y + other.h && one.y + one.h > other.y;
}

/** The boards and the cards: each keeps its lines clear of the timers on its top-right corner. */
export const BOARDS: ReadonlySet<LiveOverlayElement> = new Set([
  "question",
  "poll",
  "panelists",
  "topQuestions",
  "chat",
  "schedule",
  "checkIn",
]);

/**
 * How a board keeps its lines clear of the timers on its top-right corner
 * (the right two fifths of its top fifth), in fractions of the board. A wide
 * board keeps their column clear (`inline`, of its width from its end). One
 * too narrow for that, such as a column beside the camera, starts its top
 * row under them instead (`block`, of its height from its top) and keeps its
 * full width below, so no line is squeezed into what is left beside a timer
 * and no word breaks. Both zero when none sits there.
 */
export type LiveOverlayTimerClearance = { inline: number; block: number };

export const NO_TIMER_CLEARANCE: LiveOverlayTimerClearance = { inline: 0, block: 0 };

/** The widest share of a board the timers' column may take; past it the board's top row goes under them. */
const BESIDE_TIMERS = 0.25;
/** The most of a board's height its top row moves down for timers; a taller stack keeps its column clear instead. */
const UNDER_TIMERS = 0.4;
/** The most of a board's width a tall stack's column takes, so the board's text always keeps half of it. */
const BESIDE_TALL_TIMERS = 0.5;

export function timerClearance(
  board: LiveOverlayElementPlacement,
  timers: readonly LiveOverlayElementPlacement[],
): LiveOverlayTimerClearance {
  const corner = { x: board.x + board.w * 0.6, y: board.y, w: board.w * 0.4, h: board.h * 0.2 };
  const end = board.x + board.w;
  const covering = timers.filter(
    (timer) =>
      timer.x < corner.x + corner.w &&
      timer.x + timer.w > corner.x &&
      timer.y < corner.y + corner.h &&
      timer.y + timer.h > corner.y,
  );
  if (!covering.length || board.w <= 0 || board.h <= 0) return NO_TIMER_CLEARANCE;
  const inline = Math.max(...covering.map((timer) => (end - timer.x) / board.w));
  if (inline <= BESIDE_TIMERS) return { inline, block: 0 };
  // Under them the board keeps its full width, so every timer stacked in that column on the board counts.
  const column = timers.filter(
    (timer) =>
      timer.x < corner.x + corner.w &&
      timer.x + timer.w > corner.x &&
      timer.y < board.y + board.h &&
      timer.y + timer.h > board.y,
  );
  const block = Math.max(...column.map((timer) => (timer.y + timer.h - board.y) / board.h));
  // A stack too tall to start the top row under keeps its column clear instead, so no line runs beneath a
  // timer; a timer reaching past the board's start still leaves the text its half.
  if (block > UNDER_TIMERS) {
    return {
      inline: Math.min(BESIDE_TALL_TIMERS, Math.max(...column.map((timer) => (end - timer.x) / board.w))),
      block: 0,
    };
  }
  return { inline: 0, block };
}

/**
 * The one box a layout's question and panelists fill together, so both on
 * air draw as one board: the box they share, as on Full board or in a side
 * column, or their two boxes joined when the layout stacks them edge to edge
 * at the same width. Null when they are apart, overlap only in part, or the
 * scene leaves one out.
 */
export function joinedPanelBox(elements: LiveOverlayLayoutElements): LiveOverlayElementPlacement | null {
  const { question, panelists } = elements;
  if (!question.visible || !panelists.visible) return null;
  if (Math.abs(question.x - panelists.x) > EDGE || Math.abs(question.w - panelists.w) > EDGE) return null;
  if (Math.abs(question.y - panelists.y) <= EDGE && Math.abs(question.h - panelists.h) <= EDGE) return question;
  const [top, bottom] = question.y <= panelists.y ? [question, panelists] : [panelists, question];
  if (Math.abs(top.y + top.h - bottom.y) > EDGE) return null;
  return { ...question, y: top.y, h: top.h + bottom.h, horizontal: "center", vertical: "middle" };
}
