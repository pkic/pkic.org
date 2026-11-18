import {
  isLiveProgramLayer,
  liveProgramLayers,
  withLiveProgramOrder,
  type LiveProgramLayer,
} from "../../../../../../../../shared/live-overlay-stacking";
import type {
  LiveOverlayElement,
  LiveOverlayLayoutElements,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import { liveOverlaySourceGraphics } from "../../../../../../../live-session/live-overlay-graphics";
import type { Box } from "./overlay-layout-editing";

/**
 * A scene's graphics as the editor lists them: the Program graphics the
 * scene shows, front first, and the ones it can still add. The background
 * (the conference field) is a graphic like the others, placed, sized and
 * stacked on its own; a graphic put on the conference field carries one in
 * its own box. Pure, so the list, the canvas and the menu agree.
 */

/** The graphics this scene shows, front first: the top of the list draws in front. */
export function sceneGraphics(elements: LiveOverlayLayoutElements): LiveProgramLayer[] {
  return liveProgramLayers(elements)
    .reverse()
    .filter((element) => elements[element].visible);
}

/** The Program graphics the scene does not show yet, in the editor's order, for Add graphic. */
export function addableGraphics(elements: LiveOverlayLayoutElements): LiveOverlayElement[] {
  return liveOverlaySourceGraphics("program").filter(
    (element) => isLiveProgramLayer(element) && !elements[element].visible,
  );
}

/**
 * The scene with one shown graphic moved to another place in the list. The
 * graphics the scene hides keep their places, so showing one again puts it
 * back where it was in the stack.
 */
export function reorderSceneGraphic(
  elements: LiveOverlayLayoutElements,
  element: LiveProgramLayer,
  to: number,
): LiveOverlayLayoutElements {
  const shown = sceneGraphics(elements);
  const from = shown.indexOf(element);
  const target = Math.max(0, Math.min(shown.length - 1, to));
  if (from < 0 || from === target) return elements;
  const reordered = [...shown];
  reordered.splice(from, 1);
  reordered.splice(target, 0, element);
  // Every shown graphic takes the next reordered one's slot in the full stack; hidden ones stay put.
  const queue = [...reordered];
  const frontToBack = liveProgramLayers(elements)
    .reverse()
    .map((layer) => (shown.includes(layer) ? queue.shift()! : layer));
  return withLiveProgramOrder(elements, frontToBack);
}

/** A box's share of a side that reads as spanning it. */
const SPAN = 0.7;
/** A box's share of the other side that makes a span a half rather than a bar or a column. */
const HALF = 0.45;
/** Which third of a side a box keeps to: the edge it sits much nearer to, else the middle. */
const third = (start: number, size: number): 0 | 1 | 2 => {
  const before = start;
  const after = 1 - start - size;
  return before < after / 2 ? 0 : after < before / 2 ? 2 : 1;
};
const ROW = ["Top", "Middle", "Bottom"] as const;
const COLUMN = ["left", "center", "right"] as const;

/** Where a box sits on the frame, in a few plain words: "Bottom bar", "Right column", "Top left". */
export function describeGraphicPosition(box: Box): string {
  const wide = box.w >= SPAN;
  const tall = box.h >= SPAN;
  if (wide && tall) return "Full frame";
  const row = third(box.y, box.h);
  const column = third(box.x, box.w);
  if (wide) {
    const edge = row === 0 ? "Top" : row === 2 ? "Bottom" : "Middle";
    return box.h >= HALF && row !== 1 ? `${edge} half` : `${edge} bar`;
  }
  if (tall) {
    const side = column === 0 ? "Left" : column === 2 ? "Right" : "Center";
    return box.w >= HALF && column !== 1 ? `${side} half` : `${side} column`;
  }
  if (row === 1 && column === 1) return "Center";
  return `${ROW[row]} ${COLUMN[column]}`;
}
