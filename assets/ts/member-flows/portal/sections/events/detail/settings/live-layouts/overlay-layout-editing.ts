import { LIVE_OVERLAY_SAFE_MARGIN } from "../../../../../../../../shared/live-overlay-geometry";
import { LIVE_OVERLAY_FRAME, LIVE_OVERLAY_MIN_BOX } from "../../../../../../../../shared/schemas/live-overlay-layout";

/**
 * The layout editor's geometry: moving, resizing and nudging an element's box
 * on the 16:9 frame, snapping to the grid, the frame, the title-safe area and
 * the other elements' edges. Boxes are fractions of the frame. Pure, so a
 * drag, the arrow keys and the numeric fields agree.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The grid an element snaps to, in pixels of the 1920 × 1080 frame. */
export const LAYOUT_GRID_PX = 24;
/** An arrow key moves one pixel; with Shift, one grid step. */
export const NUDGE_PX = 1;

/** The edges a box can be dragged by: a side, or a corner (two sides). */
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const RESIZE_HANDLES: readonly ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** The lines a box snaps to along one axis, and the ones a guide is drawn for. */
export interface SnapTargets {
  vertical: number[];
  horizontal: number[];
}
/** The guides to draw: the lines the box snapped to. */
export type SnapGuides = SnapTargets;

const EPSILON = 1e-9;
const round = (value: number) => Math.round(value * 10_000) / 10_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A box rounded to the stored precision (a tenth of a pixel or finer) and kept inside the frame. */
export function normalizeBox(box: Box): Box {
  const w = round(clamp(box.w, LIVE_OVERLAY_MIN_BOX, 1));
  const h = round(clamp(box.h, LIVE_OVERLAY_MIN_BOX, 1));
  return { x: round(clamp(box.x, 0, 1 - w)), y: round(clamp(box.y, 0, 1 - h)), w, h };
}

/** The frame's edges and center, the title-safe area, and every other box's edges and center. */
export function snapTargets(others: readonly Box[]): SnapTargets {
  const lines = (start: (box: Box) => number, size: (box: Box) => number) => [
    0,
    0.5,
    1,
    LIVE_OVERLAY_SAFE_MARGIN,
    1 - LIVE_OVERLAY_SAFE_MARGIN,
    ...others.flatMap((box) => [start(box), start(box) + size(box) / 2, start(box) + size(box)]),
  ];
  return {
    vertical: lines(
      (box) => box.x,
      (box) => box.w,
    ),
    horizontal: lines(
      (box) => box.y,
      (box) => box.h,
    ),
  };
}

/** The nearest target to any of the candidate lines within the threshold, as the shift that lands on it. */
function nearest(candidates: readonly number[], targets: readonly number[], threshold: number) {
  let best: { shift: number; line: number } | null = null;
  for (const candidate of candidates)
    for (const line of targets) {
      const shift = line - candidate;
      if (Math.abs(shift) <= threshold + EPSILON && (!best || Math.abs(shift) < Math.abs(best.shift)))
        best = { shift, line };
    }
  return best;
}

const gridStep = { x: LAYOUT_GRID_PX / LIVE_OVERLAY_FRAME.width, y: LAYOUT_GRID_PX / LIVE_OVERLAY_FRAME.height };
const toGrid = (value: number, step: number) => Math.round(value / step) * step;

export interface SnapOptions {
  targets: SnapTargets;
  /** How close, as a fraction of each side, a line must be to pull the box onto it. */
  threshold: { x: number; y: number };
  /** Off while the operator holds Alt: the box follows the pointer exactly. */
  snap: boolean;
}

/**
 * The box moved by a pointer offset. Its left, center or right edge lands on
 * the nearest guide line within the threshold, else its left edge on the
 * grid; the same for its top, middle and bottom.
 */
export function moveBox(start: Box, dx: number, dy: number, options: SnapOptions): { box: Box; guides: SnapGuides } {
  let x = clamp(start.x + dx, 0, 1 - start.w);
  let y = clamp(start.y + dy, 0, 1 - start.h);
  const guides: SnapGuides = { vertical: [], horizontal: [] };
  if (options.snap) {
    const along = (position: number, size: number, targets: number[], threshold: number, step: number) => {
      const hit = nearest([position, position + size / 2, position + size], targets, threshold);
      return hit
        ? { position: position + hit.shift, line: hit.line }
        : { position: toGrid(position, step), line: null };
    };
    const horizontal = along(x, start.w, options.targets.vertical, options.threshold.x, gridStep.x);
    const vertical = along(y, start.h, options.targets.horizontal, options.threshold.y, gridStep.y);
    x = clamp(horizontal.position, 0, 1 - start.w);
    y = clamp(vertical.position, 0, 1 - start.h);
    if (horizontal.line !== null) guides.vertical.push(horizontal.line);
    if (vertical.line !== null) guides.horizontal.push(vertical.line);
  }
  return { box: normalizeBox({ ...start, x, y }), guides };
}

/**
 * The box resized by dragging one handle. Each dragged edge lands on the
 * nearest guide line within the threshold, else on the grid; the opposite
 * edges stay put, and the box never shrinks below the smallest size.
 */
export function resizeBox(
  start: Box,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  options: SnapOptions,
): { box: Box; guides: SnapGuides } {
  let left = start.x;
  let right = start.x + start.w;
  let top = start.y;
  let bottom = start.y + start.h;
  const guides: SnapGuides = { vertical: [], horizontal: [] };
  const edge = (value: number, targets: number[], threshold: number, step: number, axis: keyof SnapGuides) => {
    if (!options.snap) return value;
    const hit = nearest([value], targets, threshold);
    if (hit) {
      guides[axis].push(hit.line);
      return value + hit.shift;
    }
    return toGrid(value, step);
  };
  if (handle.includes("w"))
    left = clamp(
      edge(left + dx, options.targets.vertical, options.threshold.x, gridStep.x, "vertical"),
      0,
      right - LIVE_OVERLAY_MIN_BOX,
    );
  if (handle.includes("e"))
    right = clamp(
      edge(right + dx, options.targets.vertical, options.threshold.x, gridStep.x, "vertical"),
      left + LIVE_OVERLAY_MIN_BOX,
      1,
    );
  if (handle.includes("n"))
    top = clamp(
      edge(top + dy, options.targets.horizontal, options.threshold.y, gridStep.y, "horizontal"),
      0,
      bottom - LIVE_OVERLAY_MIN_BOX,
    );
  if (handle.includes("s"))
    bottom = clamp(
      edge(bottom + dy, options.targets.horizontal, options.threshold.y, gridStep.y, "horizontal"),
      top + LIVE_OVERLAY_MIN_BOX,
      1,
    );
  return { box: normalizeBox({ x: left, y: top, w: right - left, h: bottom - top }), guides };
}

/** The box moved by whole frame pixels from the keyboard, kept inside the frame. */
export function nudgeBox(start: Box, direction: "up" | "down" | "left" | "right", large: boolean): Box {
  const pixels = large ? LAYOUT_GRID_PX : NUDGE_PX;
  const dx = direction === "left" ? -pixels : direction === "right" ? pixels : 0;
  const dy = direction === "up" ? -pixels : direction === "down" ? pixels : 0;
  return normalizeBox({
    ...start,
    x: start.x + dx / LIVE_OVERLAY_FRAME.width,
    y: start.y + dy / LIVE_OVERLAY_FRAME.height,
  });
}

export type LayoutUnit = "percent" | "pixels";
export const LAYOUT_UNITS: readonly LayoutUnit[] = ["percent", "pixels"];

/** A box field in the unit the organizer reads: a percentage of the side, or pixels of 1920 × 1080. */
export function fieldValue(fraction: number, axis: "x" | "y", unit: LayoutUnit): number {
  return unit === "percent"
    ? Math.round(fraction * 10_000) / 100
    : Math.round(fraction * (axis === "x" ? LIVE_OVERLAY_FRAME.width : LIVE_OVERLAY_FRAME.height) * 10) / 10;
}

/** A typed field value back as a fraction of the side; not a number reads as NaN, which the contract refuses. */
export function fractionOf(value: string, axis: "x" | "y", unit: LayoutUnit): number {
  const number = value.trim() === "" ? Number.NaN : Number(value);
  return unit === "percent"
    ? round(number / 100)
    : round(number / (axis === "x" ? LIVE_OVERLAY_FRAME.width : LIVE_OVERLAY_FRAME.height));
}
