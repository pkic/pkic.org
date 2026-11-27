import type {
  LiveOverlayElement,
  LiveOverlayLayoutElements,
} from "../../../../../../../../shared/schemas/live-overlay-layout";

/** A label's height and a character's width, as fractions of the canvas, at the editor's usual size. */
const LABEL_HEIGHT = 0.045;
const LABEL_CHAR = 0.009;

type Side = "top" | "bottom";
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlaps = (rect: Rect, other: Rect) =>
  rect.x < other.x + other.w && other.x < rect.x + rect.w && rect.y < other.y + other.h && other.y < rect.y + rect.h;

/** The boxes in the order the canvas stacks them: larger ones first. */
const byArea = (elements: LiveOverlayLayoutElements, shown: readonly LiveOverlayElement[]) =>
  [...shown].sort((a, b) => elements[b].w * elements[b].h - elements[a].w * elements[a].h);

/** A label's width on the canvas: its characters, at least six, never wider than its box. */
const labelWidth = (box: Rect, label: string) => Math.min(box.w, Math.max(6, label.length) * LABEL_CHAR);

/** Where a box's name sits: inside its top or bottom edge, so far along it as a fraction of the box's width. */
export interface LabelPlace {
  side: Side;
  along: number;
}

/** The safe areas' names, at the canvas's top right (action safe) and bottom right (title safe), which box names keep clear of. */
export const SAFE_AREA_LABELS: readonly Rect[] = [
  { x: 0.965 - 11 * LABEL_CHAR, y: 0.035, w: 11 * LABEL_CHAR, h: LABEL_HEIGHT },
  { x: 0.95 - 10 * LABEL_CHAR, y: 0.95 - LABEL_HEIGHT, w: 10 * LABEL_CHAR, h: LABEL_HEIGHT },
];

/**
 * Where each box's name goes: inside its top edge at the left, else inside
 * its bottom edge, else further along either edge, past the names that are
 * in the way, so no name covers another or a name in `reserved`. Larger boxes
 * come first, as the canvas stacks them; a name with no free place keeps the
 * top left.
 */
export function layoutLabelPlaces(
  elements: LiveOverlayLayoutElements,
  shown: readonly LiveOverlayElement[],
  labels: Partial<Record<LiveOverlayElement, string>> = {},
  reserved: readonly Rect[] = [],
): Record<LiveOverlayElement, LabelPlace> {
  const placed: Rect[] = [...reserved];
  const places = {} as Record<LiveOverlayElement, LabelPlace>;
  for (const element of byArea(elements, shown)) {
    const box = elements[element];
    const width = labelWidth(box, labels[element] ?? element);
    const top = (side: Side) => (side === "top" ? box.y : box.y + box.h - LABEL_HEIGHT);
    const at = (side: Side, x: number) => ({ x, y: top(side), w: width, h: LABEL_HEIGHT });
    const clashes = (rect: Rect) => placed.some((other) => overlaps(rect, other));
    // Along an edge: its left end, then just past each name already on that line.
    const stops = (side: Side) =>
      placed
        .filter((other) => overlaps({ x: box.x, y: top(side), w: box.w, h: LABEL_HEIGHT }, other))
        .map((other) => other.x + other.w + LABEL_CHAR / 2)
        .filter((x) => x > box.x && x + width <= box.x + box.w)
        .sort((a, b) => a - b);
    const candidates: Array<[Side, number]> = [
      ["top", box.x],
      ["bottom", box.x],
      ...stops("top").map((x): [Side, number] => ["top", x]),
      ...stops("bottom").map((x): [Side, number] => ["bottom", x]),
    ];
    const [side, x] = candidates.find(([side, x]) => !clashes(at(side, x))) ?? ["top", box.x];
    places[element] = { side, along: box.w > 0 ? (x - box.x) / box.w : 0 };
    placed.push(at(side, x));
  }
  return places;
}

const SAFE_AREAS_KEY = "pkic.live-layouts.safe-areas";

/** Whether this viewer shows the safe-area guides; on unless they turned them off. */
export function readSafeAreasPreference(): boolean {
  try {
    return localStorage.getItem(SAFE_AREAS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function saveSafeAreasPreference(shown: boolean): void {
  try {
    localStorage.setItem(SAFE_AREAS_KEY, shown ? "on" : "off");
  } catch {
    // A blocked storage keeps the choice for this visit only.
  }
}
