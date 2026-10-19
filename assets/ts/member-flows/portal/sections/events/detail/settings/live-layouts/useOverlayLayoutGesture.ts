import { useCallback, useRef } from "preact/hooks";
import { usePointerDragSession } from "../../../../../../../hooks/usePointerDragSession";
import {
  LIVE_OVERLAY_FRAME,
  type LiveOverlayElement,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import {
  moveBox,
  resizeBox,
  snapTargets,
  type Box,
  type ResizeHandle,
  type SnapGuides,
} from "./overlay-layout-editing";

/** A press becomes a drag once the pointer travels this far, so a click on a box stays a selection. */
const DRAG_THRESHOLD_PX = 3;
/** How near, in screen pixels, an edge must come to a guide line to snap onto it. */
const SNAP_PX = 8;

/** Puts a box element at its place on the canvas through the custom properties the stylesheet reads. */
export function placeLayoutBox(node: HTMLElement, box: Box): void {
  node.style.setProperty("--box-x", String(box.x));
  node.style.setProperty("--box-y", String(box.y));
  node.style.setProperty("--box-w", String(box.w));
  node.style.setProperty("--box-h", String(box.h));
}

interface Gesture {
  kind: "move" | ResizeHandle;
  element: LiveOverlayElement;
  pointer: number;
  handle: Element;
  startX: number;
  startY: number;
  x: number;
  y: number;
  alt: boolean;
  started: boolean;
  frame: number | null;
  canvas: DOMRect;
  start: Box;
  others: Box[];
  box: Box;
}

/**
 * Dragging and resizing a layout's element boxes with pointer events, so a
 * mouse, a pen and a finger work alike. While a gesture runs nothing
 * re-renders: one animation frame per pointer move snaps the box, moves it
 * (and the graphic drawn for it) with a transform or sizes it, and shows the
 * guides it snapped to. The box is committed once, on release; Escape puts it
 * back. Hold Alt to place it freely.
 */
export function useOverlayLayoutGesture(
  boxes: Readonly<Record<LiveOverlayElement, Box>>,
  /** The other elements drawn with the one being moved, whose edges it snaps to. */
  peers: (element: LiveOverlayElement) => Box[],
  commit: (element: LiveOverlayElement, box: Box) => void,
) {
  const canvas = useRef<HTMLDivElement>(null);
  const verticalGuide = useRef<HTMLDivElement>(null);
  const horizontalGuide = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<LiveOverlayElement, HTMLElement>());
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef({ boxes, peers, commit });
  latest.current = { boxes, peers, commit };

  const refs = useRef(new Map<string, (node: HTMLElement | null) => void>());
  /** A stable ref callback per element, so a re-render does not detach every box. */
  const register = useCallback((element: LiveOverlayElement) => {
    let ref = refs.current.get(element);
    if (!ref) {
      ref = (node) => {
        if (node) nodes.current.set(element, node);
        else nodes.current.delete(element);
      };
      refs.current.set(element, ref);
    }
    return ref;
  }, []);

  /** The graphic the overlay draws for an element, which moves with its box during a drag. */
  const layer = (element: LiveOverlayElement) =>
    canvas.current?.querySelector<HTMLElement>(`[data-overlay-element="${element}"]`) ?? null;

  const showGuides = (shown: SnapGuides | null) => {
    for (const axis of ["vertical", "horizontal"] as const) {
      const node = (axis === "vertical" ? verticalGuide : horizontalGuide).current;
      if (!node) continue;
      const line = shown?.[axis][0];
      if (line === undefined) node.removeAttribute("data-active");
      else {
        node.style.setProperty("--guide", String(line));
        node.setAttribute("data-active", "");
      }
    }
  };

  const finish = (save: boolean) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    if (active.frame !== null) cancelAnimationFrame(active.frame);
    const node = nodes.current.get(active.element);
    node?.style.removeProperty("transform");
    node?.removeAttribute("data-gesture");
    layer(active.element)?.style.removeProperty("transform");
    layer(active.element)?.style.removeProperty("transform-origin");
    canvas.current?.removeAttribute("data-gesture");
    showGuides(null);
    if (active.handle.hasPointerCapture?.(active.pointer)) active.handle.releasePointerCapture(active.pointer);
    if (!active.started) return;
    const changed = (Object.keys(active.box) as Array<keyof Box>).some((key) => active.box[key] !== active.start[key]);
    if (save && changed) {
      // The box stays where it was dropped until the committed layout redraws it there.
      if (node) placeLayoutBox(node, active.box);
      latest.current.commit(active.element, active.box);
    } else if (node) placeLayoutBox(node, active.start);
  };

  const frame = () => {
    const active = gesture.current;
    if (!active) return;
    active.frame = null;
    const node = nodes.current.get(active.element);
    if (!node) return;
    const dx = (active.x - active.startX) / active.canvas.width;
    const dy = (active.y - active.startY) / active.canvas.height;
    const options = {
      targets: snapTargets(active.others),
      threshold: { x: SNAP_PX / active.canvas.width, y: SNAP_PX / active.canvas.height },
      snap: !active.alt,
    };
    const result =
      active.kind === "move"
        ? moveBox(active.start, dx, dy, options)
        : resizeBox(active.start, active.kind, dx, dy, options);
    active.box = result.box;
    if (active.kind === "move") {
      const shiftX = result.box.x - active.start.x;
      const shiftY = result.box.y - active.start.y;
      node.style.setProperty(
        "transform",
        `translate(${shiftX * active.canvas.width}px, ${shiftY * active.canvas.height}px)`,
      );
      layer(active.element)?.style.setProperty(
        "transform",
        `translate(${shiftX * LIVE_OVERLAY_FRAME.width}px, ${shiftY * LIVE_OVERLAY_FRAME.height}px)`,
      );
    } else {
      placeLayoutBox(node, result.box);
      // The graphic follows the box as it resizes: the old box scaled onto the new one, settled exactly on release.
      const { width: W, height: H } = LIVE_OVERLAY_FRAME;
      const scale = Math.min(result.box.w / active.start.w, result.box.h / active.start.h);
      layer(active.element)?.style.setProperty("transform-origin", "0 0");
      layer(active.element)?.style.setProperty(
        "transform",
        `translate(${(result.box.x - active.start.x * scale) * W}px, ${(result.box.y - active.start.y * scale) * H}px) scale(${scale})`,
      );
    }
    showGuides(result.guides);
  };

  const begin = (kind: Gesture["kind"], element: LiveOverlayElement, event: PointerEvent) => {
    const area = canvas.current;
    if (event.button !== 0 || !area || gesture.current) return;
    const handle = event.currentTarget as Element;
    const start = latest.current.boxes[element];
    gesture.current = {
      kind,
      element,
      pointer: event.pointerId,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      alt: event.altKey,
      started: false,
      frame: null,
      canvas: area.getBoundingClientRect(),
      start,
      others: latest.current.peers(element),
      box: start,
    };
    handle.setPointerCapture?.(event.pointerId);
    if (kind !== "move") {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const { release, cancel, requestFrame } = usePointerDragSession(gesture, finish);

  const move = (event: PointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    active.x = event.clientX;
    active.y = event.clientY;
    active.alt = event.altKey;
    if (!active.started) {
      if (Math.hypot(active.x - active.startX, active.y - active.startY) < DRAG_THRESHOLD_PX) return;
      active.started = true;
      nodes.current.get(active.element)?.setAttribute("data-gesture", active.kind === "move" ? "move" : "resize");
      canvas.current?.setAttribute("data-gesture", "");
    }
    event.preventDefault();
    requestFrame(active, frame);
  };

  /** Pointer handlers for an element's box (to move it) or one of its handles (to resize it). */
  const handlers = (kind: Gesture["kind"], element: LiveOverlayElement) => ({
    onPointerDown: (event: PointerEvent) => begin(kind, element, event),
    onPointerMove: move,
    onPointerUp: release,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
  });

  return { canvas, register, verticalGuide, horizontalGuide, handlers };
}
