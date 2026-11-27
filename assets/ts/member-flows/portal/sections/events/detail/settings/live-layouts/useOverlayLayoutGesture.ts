import { useCallback, useRef } from "preact/hooks";
import { usePointerDragSession } from "../../../../../../../hooks/usePointerDragSession";
import {
  LIVE_OVERLAY_FRAME,
  type LiveOverlayElement,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import {
  moveBox,
  resizeBox,
  shapeBox,
  FIXED_SHAPE_ELEMENTS,
  snapPeers,
  snapTargets,
  type Box,
  type ResizeHandle,
  type SnapGuides,
  type SnapOptions,
} from "./overlay-layout-editing";
import { layoutSnapping } from "./LayoutSnapToggle";

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
  /** Shift held: the box keeps its shape. */
  shift: boolean;
  started: boolean;
  frame: number | null;
  canvas: DOMRect;
  start: Box;
  others: Box[];
  box: Box;
  /** The shape a corner resize keeps, its width over its height: a code's own shape; null for any other graphic. */
  shape: number | null;
}

/**
 * Dragging and resizing a layout's element boxes with pointer events, so a
 * mouse, a pen and a finger work alike. While a gesture runs nothing
 * re-renders: one animation frame per pointer move snaps the box, moves it
 * (and the graphic drawn for it) with a transform or sizes it, and shows the
 * guides it snapped to. The box is committed once, on release; Escape puts it
 * back. It snaps while snapping is on; Alt held does the opposite. A corner keeps a code's own shape, since
 * the code is drawn whole inside its box; Shift keeps any box's shape.
 */
export function useOverlayLayoutGesture(
  boxes: Readonly<Record<LiveOverlayElement, Box>>,
  /** The other elements drawn with the one being moved, whose edges it snaps to. */
  peers: (element: LiveOverlayElement) => Box[],
  /**
   * Commits the dropped box; `joinsSpot` for a move without Alt, so a board dropped over another may take its box.
   * False when the change is refused, so the box goes back to where it started.
   */
  commit: (element: LiveOverlayElement, box: Box, joinsSpot: boolean) => boolean | void,
) {
  const canvas = useRef<HTMLDivElement>(null);
  const verticalGuide = useRef<HTMLDivElement>(null);
  const horizontalGuide = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<LiveOverlayElement, HTMLElement>());
  const gesture = useRef<Gesture | null>(null);
  const dragged = useRef(false);
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

  /** The shape of the graphic drawn for an element: the card a positioning shell holds, else the shell itself. */
  const graphicShape = (element: LiveOverlayElement): number | null => {
    const shell = layer(element)?.querySelector(".pk-live-overlay__surface")?.firstElementChild;
    const card =
      shell instanceof HTMLElement && shell.dataset.overlayShell !== undefined ? shell.firstElementChild : shell;
    const drawn = card?.getBoundingClientRect();
    return drawn && drawn.width > 0 && drawn.height > 0 ? drawn.width / drawn.height : null;
  };

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
      const joinsSpot = active.kind === "move" && snaps(active);
      if (latest.current.commit(active.element, active.box, joinsSpot) === false && node)
        placeLayoutBox(node, active.start);
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
      snap: snaps(active),
    };
    const result = active.kind === "move" ? moveBox(active.start, dx, dy, options) : resized(active, dx, dy, options);
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
    dragged.current = false;
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
      shift: event.shiftKey,
      started: false,
      frame: null,
      canvas: area.getBoundingClientRect(),
      start,
      others: snapPeers(start, latest.current.peers(element)),
      box: start,
      shape: kind !== "move" && FIXED_SHAPE_ELEMENTS.has(element) ? graphicShape(element) : null,
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
    active.shift = event.shiftKey;
    if (!active.started) {
      if (Math.hypot(active.x - active.startX, active.y - active.startY) < DRAG_THRESHOLD_PX) return;
      active.started = true;
      dragged.current = true;
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

  /** Whether the last press became a drag, so the click that ends it picks nothing. */
  const wasDragged = () => dragged.current;

  return { canvas, register, verticalGuide, horizontalGuide, handlers, wasDragged };
}

/** Whether the gesture snaps: as the viewer set it, the other way round while Alt is held. */
const snaps = (active: Gesture) => layoutSnapping.peek() !== active.alt;

/** A box resized by a corner or a side: free, or keeping the code's own shape, or with Shift the box's shape. */
function resized(active: Gesture, dx: number, dy: number, options: SnapOptions) {
  const kind = active.kind as ResizeHandle;
  const free = resizeBox(active.start, kind, dx, dy, options);
  const { width, height } = LIVE_OVERLAY_FRAME;
  const shape = active.shape ?? (active.shift ? (active.start.w * width) / (active.start.h * height) : null);
  return shape ? shapeBox(free, active.start, kind, shape) : free;
}
