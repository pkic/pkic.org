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
 * Drops an item into a row of the grid, before the item it was dropped on.
 * The row makes room: its items, the dropped one among them, share the
 * columns evenly and take the row's height, the way the neighbours are sized;
 * whatever no longer fits moves below. Then the grid compacts.
 */
export function insertIntoGridRow<T extends GridItem>(
  items: readonly T[],
  id: string,
  beforeId: string,
  bounds: GridBounds,
): T[] {
  const moving = items.find((item) => item.id === id);
  const before = items.find((item) => item.id === beforeId);
  if (!moving || !before || moving.id === before.id) return compactGrid(items);
  const row = items.filter((item) => item.id !== id && item.y === before.y).sort((a, b) => a.x - b.x);
  const order = [...row];
  order.splice(row.indexOf(before), 0, moving);
  const fitting = order.slice(0, Math.max(1, Math.floor(bounds.columns / bounds.minW)));
  const height = Math.max(...row.map((item) => item.h));
  const share = Math.floor(bounds.columns / fitting.length);
  let extra = bounds.columns - share * fitting.length;
  let x = 0;
  const laid = new Map<string, T>();
  for (const item of fitting) {
    const w = share + (extra > 0 ? 1 : 0);
    extra -= 1;
    laid.set(item.id, { ...item, x, y: before.y, w, h: height });
    x += w;
  }
  const others = items
    .filter((item) => !laid.has(item.id))
    .map((item) => (item.y >= before.y ? { ...item, y: item.y + height } : item));
  return compactGrid([...laid.values(), ...others]);
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
