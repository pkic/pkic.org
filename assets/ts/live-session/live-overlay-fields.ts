import type {
  LiveOverlayElement,
  LiveOverlayElementPlacement,
  LiveOverlayLayoutElements,
} from "../../shared/schemas/live-overlay-layout";

/**
 * Where an output draws the conference field and how its boards meet the
 * timers on them: the geometry Program's presentation reads. Pure, in
 * fractions of the 1920 x 1080 frame.
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

/** The boards and the background under them: each carries the logo in its top-right corner. */
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

/** Whether two boxes share a whole edge, so together they make one rectangle. */
function adjoins(one: LiveOverlayElementPlacement, other: LiveOverlayElementPlacement) {
  const near = (a: number, b: number) => Math.abs(a - b) <= EDGE;
  const column = near(one.x, other.x) && near(one.w, other.w);
  const row = near(one.y, other.y) && near(one.h, other.h);
  return (
    (column && (near(one.y + one.h, other.y) || near(other.y + other.h, one.y))) ||
    (row && (near(one.x + one.w, other.x) || near(other.x + other.w, one.x)))
  );
}

/** The one box two boxes fill together. */
function joinBoxes(one: LiveOverlayElementPlacement, other: LiveOverlayElementPlacement): LiveOverlayElementPlacement {
  const x = Math.min(one.x, other.x);
  const y = Math.min(one.y, other.y);
  const w = Math.max(one.x + one.w, other.x + other.w) - x;
  const h = Math.max(one.y + one.h, other.y + other.h) - y;
  return { ...one, x, y, w, h, horizontal: "center", vertical: "middle" };
}

/** A conference field an output draws: its box, and the graphics on air on it, the lowest first, which it draws under. */
export type LiveOverlayField = { box: LiveOverlayElementPlacement; carries: LiveOverlayElement[] };

/**
 * The conference fields an output draws, one under each run of graphics on
 * the field that are on air: boards in one place, side by side or stacked
 * read as one field with one logo, and a cleared Preview draws none. A
 * graphic inside the scene's background (`ground`) draws on it, and the
 * background draws only while one does.
 */
export function liveOverlayFields(
  ground: LiveOverlayElementPlacement | null,
  onAir: ReadonlyArray<{ element: LiveOverlayElement; box: LiveOverlayElementPlacement; fielded: boolean }>,
): { ground: LiveOverlayField | null; fields: LiveOverlayField[] } {
  const scene: LiveOverlayField | null = ground ? { box: ground, carries: [] } : null;
  const fields: LiveOverlayField[] = [];
  for (const { element, box, fielded } of onAir) {
    if (scene && within(box, scene.box) && (fielded || BOARDS.has(element))) {
      scene.carries.push(element);
      continue;
    }
    if (!fielded) continue;
    const field = fields.find((each) => within(box, each.box) || adjoins(box, each.box));
    if (!field) {
      fields.push({ box, carries: [element] });
      continue;
    }
    if (!within(box, field.box)) field.box = joinBoxes(field.box, box);
    field.carries.push(element);
  }
  return { ground: scene?.carries.length ? scene : null, fields };
}

/**
 * The one box a layout's question and panelists fill together when it stacks
 * them, edge to edge at the same width, so both on air draw as one board with
 * one field and one logo. Null when they are apart, overlap or one is hidden.
 */
export function stackedPanelBox(elements: LiveOverlayLayoutElements): LiveOverlayElementPlacement | null {
  const { question, panelists } = elements;
  if (!question.visible || !panelists.visible) return null;
  if (Math.abs(question.x - panelists.x) > EDGE || Math.abs(question.w - panelists.w) > EDGE) return null;
  const [top, bottom] = question.y <= panelists.y ? [question, panelists] : [panelists, question];
  if (Math.abs(top.y + top.h - bottom.y) > EDGE) return null;
  return { ...question, y: top.y, h: top.h + bottom.h, horizontal: "center", vertical: "middle" };
}
