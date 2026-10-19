import type {
  LiveOverlayElement,
  LiveOverlayLayoutElements,
} from "../../../../../../../../shared/schemas/live-overlay-layout";

/** A label's height and a character's width, as fractions of the canvas, at the editor's usual size. */
const LABEL_HEIGHT = 0.045;
const LABEL_CHAR = 0.009;

type Side = "top" | "bottom";

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
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
  const sides = {} as Record<LiveOverlayElement, Side>;
  const order = [...shown].sort((a, b) => elements[b].w * elements[b].h - elements[a].w * elements[a].h);
  for (const element of order) {
    const box = elements[element];
    const width = Math.min(box.w, Math.max(6, (labels[element] ?? element).length) * LABEL_CHAR);
    const at = (side: Side) => ({
      x: box.x,
      y: side === "top" ? box.y : box.y + box.h - LABEL_HEIGHT,
      w: width,
      h: LABEL_HEIGHT,
    });
    const clashes = (rect: ReturnType<typeof at>) =>
      placed.some(
        (other) =>
          rect.x < other.x + other.w &&
          other.x < rect.x + rect.w &&
          rect.y < other.y + other.h &&
          other.y < rect.y + rect.h,
      );
    const side: Side = clashes(at("top")) && !clashes(at("bottom")) ? "bottom" : "top";
    sides[element] = side;
    placed.push(at(side));
  }
  return sides;
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
