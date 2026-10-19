import { useCallback, useRef } from "preact/hooks";
import { usePointerDragSession } from "../../../../../../../hooks/usePointerDragSession";
import { gridOverlaps, insertIntoGridRow, resizeGridRect, type GridEdge, type GridRect } from "./studio-grid";
import { STUDIO_COLUMNS, placeStudioPanel, studioGridBounds, type StudioPanel } from "./studio-layout";
import type { StudioChange } from "./useStudioLayout";

/** Below this grid width the panels stack in one column (see StudioGrid.css) and only the keyboard moves them. */
export const STUDIO_STACKED_BELOW = 760;
/** A press becomes a drag once the pointer travels this far, so a click on a header stays a click. */
const DRAG_THRESHOLD_PX = 4;

/** Puts a cell at its grid rectangle through the custom properties StudioGrid.css reads. */
export function placeStudioCell(node: HTMLElement, rect: GridRect): void {
  node.style.setProperty("--studio-col", String(rect.x + 1));
  node.style.setProperty("--studio-row", String(rect.y + 1));
  node.style.setProperty("--studio-w", String(rect.w));
  node.style.setProperty("--studio-h", String(rect.h));
}

interface Gesture {
  kind: "move" | "resize";
  /** The edge or corner a resize drags. */
  edge: GridEdge;
  id: string;
  pointer: number;
  handle: Element;
  startX: number;
  startY: number;
  x: number;
  y: number;
  started: boolean;
  frame: number | null;
  /** The cell's and the grid's boxes when the gesture began, and one column's and one row's pitch. */
  cell: DOMRect;
  grid: DOMRect;
  column: number;
  row: number;
  gap: number;
  base: readonly StudioPanel[];
  target: GridRect;
  preview: readonly StudioPanel[];
}

const sameRect = (a: GridRect, b: GridRect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * Dragging and resizing panels with pointer events, so mouse, touch and pen
 * work alike. While a gesture runs nothing re-renders: one animation frame
 * per pointer move translates the panel (or sizes it), snaps a placeholder to
 * the target cells and moves the other panels out of the way. The layout is
 * committed once, on release; Escape puts everything back.
 */
export function useStudioGesture(panels: readonly StudioPanel[], change: StudioChange) {
  const grid = useRef<HTMLDivElement>(null);
  const placeholder = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef(panels);
  latest.current = panels;

  const refs = useRef(new Map<string, (node: HTMLElement | null) => void>());
  /** A stable ref callback per panel, so a re-render does not detach and reattach every cell. */
  const register = useCallback((id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (node) => {
        if (node) cells.current.set(id, node);
        else cells.current.delete(id);
      };
      refs.current.set(id, ref);
    }
    return ref;
  }, []);

  /** Lays every other panel and the placeholder where the target puts them. */
  const arrange = (active: Gesture, layout: readonly StudioPanel[]) => {
    for (const panel of layout) {
      const node = cells.current.get(panel.id);
      if (node && panel.id !== active.id) placeStudioCell(node, panel);
    }
    const target = layout.find((panel) => panel.id === active.id);
    if (target && placeholder.current) placeStudioCell(placeholder.current, target);
  };

  const finish = (commit: boolean) => {
    const active = gesture.current;
    if (!active) return;
    if (active.frame !== null) {
      cancelAnimationFrame(active.frame);
      // A quick release can come before the frame that applies the last move: apply it now, or the
      // release would commit an older target, or none at all, and the panel would spring back.
      if (commit && active.started) frame();
      active.frame = null;
    }
    gesture.current = null;
    const node = cells.current.get(active.id);
    node?.style.removeProperty("transform");
    if (active.kind === "resize" && node) {
      const panel = active.base.find((entry) => entry.id === active.id);
      if (panel) placeStudioCell(node, commit ? active.target : panel);
    }
    node?.removeAttribute("data-gesture");
    grid.current?.removeAttribute("data-gesture");
    if (active.handle.hasPointerCapture?.(active.pointer)) active.handle.releasePointerCapture(active.pointer);
    if (!active.started) return;
    if (commit && active.preview !== active.base) {
      const committed = active.preview;
      change(() => [...committed]);
    } else arrange(active, active.base);
  };

  const frame = () => {
    const active = gesture.current;
    if (!active) return;
    active.frame = null;
    const node = cells.current.get(active.id);
    const panel = active.base.find((entry) => entry.id === active.id);
    if (!node || !panel) return;
    const dx = active.x - active.startX;
    const dy = active.y - active.startY;
    let target: GridRect;
    let preview: readonly StudioPanel[];
    if (active.kind === "move") {
      node.style.setProperty("transform", `translate(${dx}px, ${dy}px)`);
      // Over another panel, the dragged one joins that panel's row before it; elsewhere it lands on the cells it covers.
      const at = {
        x: Math.floor((active.x - active.grid.left) / active.column),
        y: Math.floor((active.y - active.grid.top) / active.row),
        w: 1,
        h: 1,
      };
      const over = active.base.find((entry) => entry.id !== active.id && gridOverlaps(entry, at));
      if (over) {
        preview = insertIntoGridRow(active.base, active.id, over.id, studioGridBounds(panel.type));
        target = preview.find((entry) => entry.id === active.id) ?? panel;
      } else {
        target = {
          ...panel,
          x: Math.max(
            0,
            Math.min(STUDIO_COLUMNS - panel.w, Math.round((active.cell.left - active.grid.left + dx) / active.column)),
          ),
          y: Math.max(0, Math.round((active.cell.top - active.grid.top + dy) / active.row)),
        };
        preview = placeStudioPanel(active.base, active.id, target);
      }
    } else {
      target = resizeGridRect(
        panel,
        active.edge,
        Math.round(dx / active.column),
        Math.round(dy / active.row),
        studioGridBounds(panel.type),
      );
      preview = placeStudioPanel(active.base, active.id, target);
      // The panel snaps to the cells it will take, so it grows or shrinks from the edge being dragged.
      const placed = preview.find((entry) => entry.id === active.id);
      if (placed) placeStudioCell(node, placed);
    }
    if (sameRect(target, active.target) && active.preview !== active.base) return;
    active.target = target;
    active.preview = preview;
    arrange(active, active.preview);
  };

  const begin = (kind: Gesture["kind"], panel: StudioPanel, event: PointerEvent, edge: GridEdge = "se") => {
    const node = cells.current.get(panel.id);
    const area = grid.current;
    if (event.button !== 0 || !node || !area || gesture.current) return;
    const box = area.getBoundingClientRect();
    if (box.width < STUDIO_STACKED_BELOW) return;
    const style = getComputedStyle(area);
    const gap = Number.parseFloat(style.columnGap) || 0;
    const rowGap = Number.parseFloat(style.rowGap) || 0;
    const rowHeight = Number.parseFloat(style.gridAutoRows) || 0;
    const handle = event.currentTarget as Element;
    gesture.current = {
      kind,
      edge,
      id: panel.id,
      pointer: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      started: false,
      frame: null,
      cell: node.getBoundingClientRect(),
      grid: box,
      column: (box.width + gap) / STUDIO_COLUMNS,
      row: rowHeight + rowGap,
      gap,
      base: latest.current,
      target: panel,
      preview: latest.current,
    };
    handle.setPointerCapture?.(event.pointerId);
    if (kind === "resize") event.preventDefault();
  };

  const { release, cancel, requestFrame } = usePointerDragSession(gesture, finish);

  const move = (event: PointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    active.x = event.clientX;
    active.y = event.clientY;
    if (!active.started) {
      if (Math.hypot(active.x - active.startX, active.y - active.startY) < DRAG_THRESHOLD_PX) return;
      active.started = true;
      cells.current.get(active.id)?.setAttribute("data-gesture", active.kind);
      grid.current?.setAttribute("data-gesture", active.kind);
      if (placeholder.current) placeStudioCell(placeholder.current, active.target);
    }
    event.preventDefault();
    requestFrame(active, frame);
  };

  /** Pointer handlers for a panel's drag handle (its header) or one of its resize edges. */
  const handlers = (kind: Gesture["kind"], panel: StudioPanel, edge: GridEdge = "se") => ({
    onPointerDown: (event: PointerEvent) => {
      // The header's own buttons and menus keep their clicks.
      if (kind === "move" && (event.target as Element).closest("button, a, input, select, textarea, [role='menu']"))
        return;
      begin(kind, panel, event, edge);
    },
    onPointerMove: move,
    onPointerUp: release,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  });

  return { grid, placeholder, register, handlers };
}
