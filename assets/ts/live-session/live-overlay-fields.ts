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
 * How much of a board's width, from its end, the timers on its logo corner
 * (the right two fifths of its top fifth) take: the board keeps that column
 * clear, so no line of it runs under a timer. Zero when none sits there.
 */
export function timerReserve(board: LiveOverlayElementPlacement, timers: readonly LiveOverlayElementPlacement[]) {
  const corner = { x: board.x + board.w * 0.6, y: board.y, w: board.w * 0.4, h: board.h * 0.2 };
  const end = board.x + board.w;
  const covering = timers.filter(
    (timer) =>
      timer.x < corner.x + corner.w &&
      timer.x + timer.w > corner.x &&
      timer.y < corner.y + corner.h &&
      timer.y + timer.h > corner.y,
  );
  if (!covering.length || board.w <= 0) return 0;
  return Math.min(0.4, Math.max(...covering.map((timer) => (end - timer.x) / board.w)));
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
