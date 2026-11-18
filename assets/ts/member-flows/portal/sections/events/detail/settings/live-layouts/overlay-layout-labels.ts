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

/**
 * Where each box's label goes: at its top edge, unless that would cover the
 * label of a box placed before it, in which case at its bottom edge. Larger
 * boxes come first, as the canvas stacks them.
 */
export function layoutLabelSides(
  elements: LiveOverlayLayoutElements,
  shown: readonly LiveOverlayElement[],
  labels: Partial<Record<LiveOverlayElement, string>> = {},
): Record<LiveOverlayElement, Side> {
  const placed: Rect[] = [];
  const sides = {} as Record<LiveOverlayElement, Side>;
  for (const element of byArea(elements, shown)) {
    const box = elements[element];
    const width = labelWidth(box, labels[element] ?? element);
    const at = (side: Side) => ({
      x: box.x,
      y: side === "top" ? box.y : box.y + box.h - LABEL_HEIGHT,
      w: width,
      h: LABEL_HEIGHT,
    });
    const clashes = (rect: Rect) => placed.some((other) => overlaps(rect, other));
    const side: Side = clashes(at("top")) && !clashes(at("bottom")) ? "bottom" : "top";
    sides[element] = side;
    placed.push(at(side));
  }
  return sides;
}

/** How far a centered label may move, in label lines, before it gives up and overlaps. */
const MAX_SHIFT = 4;

/**
 * Where each box's centered label goes: at the box's center, or as many
 * label lines below or above it as it takes not to cover the label of a box
 * drawn before it, while it stays inside its box. Larger boxes come first, as
 * the canvas stacks them, so boxes that share one place list their names.
 */
export function layoutLabelShifts(
  elements: LiveOverlayLayoutElements,
  shown: readonly LiveOverlayElement[],
  labels: Partial<Record<LiveOverlayElement, string>> = {},
): Partial<Record<LiveOverlayElement, number>> {
  const placed: Rect[] = [];
  const shifts: Partial<Record<LiveOverlayElement, number>> = {};
  for (const element of byArea(elements, shown)) {
    const box = elements[element];
    const width = labelWidth(box, labels[element] ?? element);
    const at = (shift: number) => ({
      x: box.x + (box.w - width) / 2,
      y: box.y + box.h / 2 - LABEL_HEIGHT / 2 + shift * LABEL_HEIGHT,
      w: width,
      h: LABEL_HEIGHT,
    });
    const fits = (rect: Rect) => rect.y >= box.y && rect.y + rect.h <= box.y + box.h;
    const clashes = (rect: Rect) => placed.some((other) => overlaps(rect, other));
    const candidates = [0, ...Array.from({ length: MAX_SHIFT }, (_, index) => [index + 1, -(index + 1)]).flat()];
    const shift = candidates.find((candidate) => fits(at(candidate)) && !clashes(at(candidate))) ?? 0;
    shifts[element] = shift;
    placed.push(at(shift));
  }
  return shifts;
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
