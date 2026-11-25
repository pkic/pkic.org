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

/**
 * The background, the boards and the cards: each keeps the timers' column
 * clear in its top-right corner, where the background carries the logo.
 */
export const BOARDS: ReadonlySet<LiveOverlayElement> = new Set([
  "background",
  "question",
  "poll",
  "panelists",
  "topQuestions",
  "chat",
  "schedule",
  "checkIn",
]);

/**
 * Where a board makes room for the timers on its logo corner (the right two
 * fifths of its top fifth), in fractions of the board. A board with room
 * beside them keeps their column clear (`inline`, of its width from its end),
 * so its logo steps aside next to them. One too narrow for that, such as a
 * column beside the camera, starts its top row under them instead (`block`,
 * of its height from its top) and keeps its full width below, so no line is
 * squeezed into what is left beside a timer. Both zero when none sits there.
 */
export type LiveOverlayTimerReserve = { inline: number; block: number };

export const NO_TIMER_RESERVE: LiveOverlayTimerReserve = { inline: 0, block: 0 };

/** The widest share of a board the timers may take beside its logo; past it the board's top row goes under them. */
const BESIDE_TIMERS = 0.25;
/** The most of a board's height its top row moves down for timers. */
const UNDER_TIMERS = 0.4;

export function timerReserve(
  board: LiveOverlayElementPlacement,
  timers: readonly LiveOverlayElementPlacement[],
): LiveOverlayTimerReserve {
  const corner = { x: board.x + board.w * 0.6, y: board.y, w: board.w * 0.4, h: board.h * 0.2 };
  const end = board.x + board.w;
  const covering = timers.filter(
    (timer) =>
      timer.x < corner.x + corner.w &&
      timer.x + timer.w > corner.x &&
      timer.y < corner.y + corner.h &&
      timer.y + timer.h > corner.y,
  );
  if (!covering.length || board.w <= 0 || board.h <= 0) return NO_TIMER_RESERVE;
  const inline = Math.max(...covering.map((timer) => (end - timer.x) / board.w));
  if (inline <= BESIDE_TIMERS) return { inline, block: 0 };
  const block = Math.max(...covering.map((timer) => (timer.y + timer.h - board.y) / board.h));
  return { inline: 0, block: Math.min(UNDER_TIMERS, block) };
}

/**
 * The one box a layout's question and panelists fill together when it stacks
 * them, edge to edge at the same width, so both on air draw as one board.
 * Null when they are apart, overlap or the scene leaves one out.
 */
export function stackedPanelBox(elements: LiveOverlayLayoutElements): LiveOverlayElementPlacement | null {
  const { question, panelists } = elements;
  if (!question.visible || !panelists.visible) return null;
  if (Math.abs(question.x - panelists.x) > EDGE || Math.abs(question.w - panelists.w) > EDGE) return null;
  const [top, bottom] = question.y <= panelists.y ? [question, panelists] : [panelists, question];
  if (Math.abs(top.y + top.h - bottom.y) > EDGE) return null;
  return { ...question, y: top.y, h: top.h + bottom.h, horizontal: "center", vertical: "middle" };
}
