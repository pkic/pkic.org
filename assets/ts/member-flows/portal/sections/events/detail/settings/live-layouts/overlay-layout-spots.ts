import {
  LIVE_OVERLAY_BOARDS,
  liveOverlaySpotOf,
  liveOverlaySpotTurns,
} from "../../../../../../../../shared/live-overlay-spots";
import { isLiveProgramLayer, type LiveProgramLayer } from "../../../../../../../../shared/live-overlay-stacking";
import type {
  LiveOverlayElement,
  LiveOverlayLayoutElements,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import type { Box } from "./overlay-layout-editing";

/**
 * The scene editor's spots: a board dropped mostly over another board takes
 * that board's box, so the two form one spot, and a spot's turns are set on
 * every board in it. Pure, so the canvas and the list agree.
 */

/** The share of a dropped board's box that another board must cover before the dropped one joins its spot. */
const SPOT_SNAP = 0.5;

const isBoard = (element: LiveOverlayElement): element is LiveProgramLayer =>
  isLiveProgramLayer(element) && LIVE_OVERLAY_BOARDS.has(element);

/** The share of `box` that `other` covers. */
function share(box: Box, other: Box): number {
  const w = Math.min(box.x + box.w, other.x + other.w) - Math.max(box.x, other.x);
  const h = Math.min(box.y + box.h, other.y + other.h) - Math.max(box.y, other.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (box.w * box.h);
}

/**
 * Where a dropped board lands: in the box of the board that covers most of
 * it, when that is at least half of it, so the two share one spot; else
 * where it was dropped. Any other graphic lands where it was dropped.
 */
export function snapIntoSpot(elements: LiveOverlayLayoutElements, element: LiveOverlayElement, box: Box): Box {
  if (!isBoard(element)) return box;
  const others = [...LIVE_OVERLAY_BOARDS]
    .filter((board) => board !== element && elements[board].visible)
    .map((board) => elements[board])
    .map((other) => ({ other, covered: share(box, other) }))
    .filter(({ covered }) => covered >= SPOT_SNAP)
    .sort((a, b) => b.covered - a.covered);
  const target = others[0]?.other;
  return target ? { x: target.x, y: target.y, w: target.w, h: target.h } : box;
}

/**
 * The turns a board takes in the spot it is in now: the spot's own, read
 * from the other boards in it, or none when it shows only its front board or
 * the board has its box to itself.
 */
export function spotTurnsFor(elements: LiveOverlayLayoutElements, element: LiveOverlayElement): number | undefined {
  if (!isBoard(element)) return undefined;
  const spot = liveOverlaySpotOf(elements, element);
  if (!spot) return undefined;
  return (
    liveOverlaySpotTurns(
      elements,
      spot.filter((board) => board !== element),
    ) ?? undefined
  );
}

/** The scene with a spot's boards taking turns every `turns` seconds, or showing only the front one (null). */
export function withSpotTurns(
  elements: LiveOverlayLayoutElements,
  element: LiveProgramLayer,
  turns: number | null,
): LiveOverlayLayoutElements {
  const spot = liveOverlaySpotOf(elements, element) ?? [element];
  const next = { ...elements };
  for (const board of spot) next[board] = { ...next[board], turns: turns ?? undefined };
  return next;
}
