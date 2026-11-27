import { liveProgramLayers, type LiveProgramLayer } from "./live-overlay-stacking";
import type { LiveOverlayElementPlacement, LiveOverlayLayoutElements } from "./schemas/live-overlay-layout";

/**
 * Spots: the boards a scene puts in one box. A spot shows its front board
 * that is on, or lets the boards that are on take turns, each for the spot's
 * interval, in the order the scene stacks them. A board that covers another
 * board entirely hides it; two boards that only partly overlap are a mistake
 * the scene editor points out. Pure, so the outputs, the studio and the
 * editor agree.
 */

/**
 * The graphics that take a spot of the frame: the boards and the cards. The
 * background is the frame's field, under them, and never in a spot.
 */
export const LIVE_OVERLAY_BOARDS: ReadonlySet<LiveProgramLayer> = new Set([
  "panelists",
  "schedule",
  "checkIn",
  "question",
  "poll",
  "topQuestions",
  "chat",
  "speakerWelcome",
]);

/** How long each board in a spot shows before the next takes its turn, unless the scene says otherwise. */
export const LIVE_SPOT_TURN_SECONDS = 15;
/** The intervals a scene offers for a spot's turns, in seconds. */
export const LIVE_SPOT_TURN_CHOICES = [10, 15, 30, 60] as const;

/** Edges this close, as a fraction of the frame (about 4px), are one edge. */
const SAME_EDGE = 0.002;

type Box = Pick<LiveOverlayElementPlacement, "x" | "y" | "w" | "h">;

/** Whether two boxes are one box on the frame. */
export function sameLiveBox(a: Box, b: Box): boolean {
  return (
    Math.abs(a.x - b.x) <= SAME_EDGE &&
    Math.abs(a.y - b.y) <= SAME_EDGE &&
    Math.abs(a.w - b.w) <= SAME_EDGE &&
    Math.abs(a.h - b.h) <= SAME_EDGE
  );
}

/** Whether `over` covers all of `under`. */
export function liveBoxCovers(over: Box, under: Box): boolean {
  return (
    over.x <= under.x + SAME_EDGE &&
    over.y <= under.y + SAME_EDGE &&
    over.x + over.w >= under.x + under.w - SAME_EDGE &&
    over.y + over.h >= under.y + under.h - SAME_EDGE
  );
}

/** Whether two boxes share some of the frame, more than a shared edge. */
function liveBoxesMeet(a: Box, b: Box): boolean {
  return (
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > SAME_EDGE &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > SAME_EDGE
  );
}

/** The scene's boards, front first. */
const sceneBoards = (elements: LiveOverlayLayoutElements) =>
  liveProgramLayers(elements)
    .reverse()
    .filter((layer) => LIVE_OVERLAY_BOARDS.has(layer) && elements[layer].visible);

/** The scene's spots: two or more of its boards in one box, each front first. */
export function liveOverlaySpots(elements: LiveOverlayLayoutElements): LiveProgramLayer[][] {
  const spots: LiveProgramLayer[][] = [];
  for (const board of sceneBoards(elements)) {
    const spot = spots.find((candidate) => sameLiveBox(elements[candidate[0]!], elements[board]));
    if (spot) spot.push(board);
    else spots.push([board]);
  }
  return spots.filter((spot) => spot.length > 1);
}

/** The spot a graphic is in, front first; null when it has its box to itself. */
export function liveOverlaySpotOf(
  elements: LiveOverlayLayoutElements,
  layer: LiveProgramLayer,
): LiveProgramLayer[] | null {
  return liveOverlaySpots(elements).find((spot) => spot.includes(layer)) ?? null;
}

/** The seconds each board in a spot shows before the next one's turn; null when only its front board shows. */
export function liveOverlaySpotTurns(
  elements: LiveOverlayLayoutElements,
  spot: readonly LiveProgramLayer[],
): number | null {
  for (const board of spot) {
    const turns = elements[board].turns;
    if (turns) return turns;
  }
  return null;
}

/**
 * Whose turn it is in a spot that takes turns: of the boards that are on,
 * front first, the one the clock is at. Every output reads the same clock,
 * so all of them show the same board.
 */
export function liveOverlayTurnHolder<Board>(on: readonly Board[], turns: number, now: number): Board | null {
  if (on.length === 0) return null;
  return on[Math.floor(now / (turns * 1000)) % on.length]!;
}

/** When the next turn starts, in milliseconds since the epoch. */
export function liveOverlayNextTurnAt(turns: number, now: number): number {
  const period = turns * 1000;
  return (Math.floor(now / period) + 1) * period;
}

/**
 * Two boards that partly overlap: neither has the other's box nor covers it,
 * so each draws over part of the other. The editor asks to put them in one
 * spot or apart. Front one first.
 */
export function liveOverlayPartialOverlaps(
  elements: LiveOverlayLayoutElements,
): Array<[LiveProgramLayer, LiveProgramLayer]> {
  const boards = sceneBoards(elements);
  const overlaps: Array<[LiveProgramLayer, LiveProgramLayer]> = [];
  boards.forEach((front, index) => {
    for (const back of boards.slice(index + 1)) {
      const a = elements[front];
      const b = elements[back];
      if (liveBoxesMeet(a, b) && !liveBoxCovers(a, b) && !liveBoxCovers(b, a)) overlaps.push([front, back]);
    }
  });
  return overlaps;
}
