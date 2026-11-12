/**
 * The geometry of a dashboard grid: items sit on whole columns and rows, never
 * overlap, and float up to fill the space above them. Placing one item where
 * an operator drops it pushes the items it lands on out of the way, then the
 * whole grid compacts upwards. Pure functions, so the drag preview, the
 * keyboard commands and the saved layout all agree.
 */

export interface GridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface GridItem extends GridRect {
  id: string;
}
export interface GridBounds {
  columns: number;
  minW: number;
  minH: number;
  maxH: number;
}

export const gridOverlaps = (a: GridRect, b: GridRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Reading order: top to bottom, then left to right. */
export const byGridPosition = (a: GridRect, b: GridRect) => a.y - b.y || a.x - b.x;

/** A rectangle that fits the grid: whole cells, within the columns and the size limits. */
export function clampGridRect(rect: GridRect, bounds: GridBounds): GridRect {
  const w = Math.max(bounds.minW, Math.min(bounds.columns, Math.round(rect.w)));
  return {
    w,
    h: Math.max(bounds.minH, Math.min(bounds.maxH, Math.round(rect.h))),
    x: Math.max(0, Math.min(bounds.columns - w, Math.round(rect.x))),
    y: Math.max(0, Math.round(rect.y)),
  };
}

function firstCollision(rect: GridRect, placed: readonly GridRect[]): GridRect | undefined {
  return placed.find((other) => gridOverlaps(rect, other));
}

/** Moves the item down past whatever it overlaps until it overlaps nothing. */
function pushDown<T extends GridRect>(item: T, placed: readonly GridRect[]): T {
  let next = item;
  for (let hit = firstCollision(next, placed); hit; hit = firstCollision(next, placed))
    next = { ...next, y: hit.y + hit.h };
  return next;
}

/** Floats every item up as far as it goes, in reading order, so no gap is left above an item. */
export function compactGrid<T extends GridItem>(items: readonly T[]): T[] {
  const placed: T[] = [];
  for (const item of [...items].sort(byGridPosition)) {
    let next = pushDown(item, placed);
    while (next.y > 0 && !firstCollision({ ...next, y: next.y - 1 }, placed)) next = { ...next, y: next.y - 1 };
    placed.push(next);
  }
  return placed.sort(byGridPosition);
}

/**
 * Puts one item at a rectangle and settles the others around it. An item it
 * lands on moves above it when there is room there, else below it; then the
 * grid compacts. Returns the items in reading order.
 */
export function placeGridItem<T extends GridItem>(
  items: readonly T[],
  id: string,
  rect: GridRect,
  bounds: GridBounds,
): T[] {
  const moving = items.find((item) => item.id === id);
  if (!moving) return compactGrid(items);
  const target = { ...moving, ...clampGridRect(rect, bounds) };
  const placed: T[] = [target];
  for (const item of items.filter((entry) => entry.id !== id).sort(byGridPosition)) {
    if (gridOverlaps(item, target)) {
      const above = { ...item, y: target.y - item.h };
      if (above.y >= 0 && !firstCollision(above, placed)) {
        placed.push(above);
        continue;
      }
    }
    placed.push(pushDown(item, placed));
  }
  return compactGrid(placed);
}

/** Which edges a resize moves: any side or corner of the item. */
export type GridEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * The rectangle a resize from one edge or corner gives, by whole columns and
 * rows. The opposite edges stay put, and the item keeps its minimum size.
 */
export function resizeGridRect(
  rect: GridRect,
  edge: GridEdge,
  columns: number,
  rows: number,
  bounds: GridBounds,
): GridRect {
  let { x, y, w, h } = rect;
  if (edge.includes("e")) w = Math.max(bounds.minW, Math.min(bounds.columns - x, rect.w + columns));
  if (edge.includes("w")) {
    x = Math.max(0, Math.min(rect.x + rect.w - bounds.minW, rect.x + columns));
    w = rect.w + rect.x - x;
  }
  if (edge.includes("s")) h = Math.max(bounds.minH, Math.min(bounds.maxH, rect.h + rows));
  if (edge.includes("n")) {
    y = Math.max(0, Math.min(rect.y + rect.h - bounds.minH, rect.y + rows));
    h = Math.min(bounds.maxH, rect.h + rect.y - y);
  }
  return { x, y, w, h };
}

/**
 * Swaps an item with the one it was dropped on: each takes the other's place
 * and keeps its own size. When the sizes differ so they would overlap, the
 * one dropped on moves beside it, or, when the row is full, the upper of the
 * two keeps its place and the other goes below it; the others move out of
 * the way, then the grid compacts.
 */
export function swapGridItems<T extends GridItem>(
  items: readonly T[],
  id: string,
  withId: string,
  columns: number,
): T[] {
  const moving = items.find((item) => item.id === id);
  const other = items.find((item) => item.id === withId);
  if (!moving || !other || moving === other) return compactGrid(items);
  let dropped = { ...moving, x: Math.min(other.x, columns - moving.w), y: other.y };
  let swapped = { ...other, x: Math.min(moving.x, columns - other.w), y: moving.y };
  if (gridOverlaps(dropped, swapped)) {
    // Beside the dropped one in its row when it fits there; else the one that ends up on top keeps its place
    // and the other goes below it, so a drop downward still swaps.
    const beside = { ...swapped, x: dropped.x + dropped.w, y: dropped.y };
    if (beside.x + beside.w <= columns) swapped = beside;
    else if (moving.y < other.y) dropped = { ...dropped, y: swapped.y + swapped.h };
    else swapped = { ...swapped, y: dropped.y + dropped.h };
  }
  const placed: T[] = [dropped, swapped];
  for (const item of items.filter((entry) => entry !== moving && entry !== other).sort(byGridPosition))
    placed.push(pushDown(item, placed));
  return compactGrid(placed);
}

/** Lays items without positions (or from an older shape) left to right, wrapping at the last column. */
export function flowGrid<T extends { id: string }>(
  items: readonly T[],
  size: (item: T) => { w: number; h: number },
  bounds: GridBounds,
): Array<T & GridRect> {
  const placed: Array<T & GridRect> = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const item of items) {
    const { w, h } = clampGridRect({ x: 0, y: 0, ...size(item) }, bounds);
    if (x + w > bounds.columns) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    placed.push({ ...item, x, y, w, h });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return compactGrid(placed);
}
