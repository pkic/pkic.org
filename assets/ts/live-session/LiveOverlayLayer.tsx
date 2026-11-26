import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { liveOverlayLayerTransform, type OverlayRect } from "../../shared/live-overlay-geometry";
import { LIVE_OVERLAY_FRAME } from "../../shared/schemas/live-overlay-layout";
import type { LiveOverlayElement, LiveOverlayElementPlacement } from "../../shared/schemas/live-overlay-layout";
import { NO_TIMER_CLEARANCE, type LiveOverlayTimerClearance } from "./live-overlay-fields";

const FULL_FRAME: OverlayRect = { x: 0, y: 0, width: LIVE_OVERLAY_FRAME.width, height: LIVE_OVERLAY_FRAME.height };

/** A graphic's move to its box in the next scene, with room to finish: the stylesheet moves it in `--pk-dur-slow`. */
const SCENE_MOVE_MILLISECONDS = 600;

/**
 * Whether an output is changing scene: from the render that draws another
 * scene until the graphics that stay on have moved to their boxes in it.
 * Only then does a layer move with a transition, and only to a box of the
 * size it had; at any other time a graphic is placed at once, as when it
 * comes on, its content changes size, or the scene gives it another size.
 */
export function useLiveSceneMove(scene: string | null): boolean {
  const [move, setMove] = useState({ scene, moving: false });
  const changed = move.scene !== scene;
  // Another scene while one is still moving starts the wait again, so no move is cut short.
  if (changed) setMove({ scene, moving: true });
  useEffect(() => {
    if (!move.moving) return;
    const settled = setTimeout(() => setMove((current) => ({ ...current, moving: false })), SCENE_MOVE_MILLISECONDS);
    return () => clearTimeout(settled);
  }, [move]);
  return changed || move.moving;
}

/**
 * One element of the overlay in its layout box. The graphic is drawn at its
 * standard broadcast size on the 1920 × 1080 frame, measured, then moved and
 * scaled whole into the box at the box's anchor. A graphic that already fills
 * its box exactly is left untransformed, so a full-frame layout draws as it
 * always has. Layers keep one order in the document whatever the scene, so a
 * graphic that stays on is never taken out and put back, which would restart
 * its motion; the scene's stack order reaches the stylesheet as `order`.
 */
export function LiveOverlayLayer({
  element,
  placement,
  order,
  moving = false,
  on = true,
  dimmed = false,
  timerClearance = NO_TIMER_CLEARANCE,
  onGround = false,
  children,
}: {
  element: LiveOverlayElement;
  /** The layer's place in the scene's stack, bottom first: a higher one draws in front. */
  order: number;
  /** The output is changing scene: a graphic that stays on, in a box of the same size, moves there instead of jumping. */
  moving?: boolean;
  /** Whether the graphic has something drawn; the lower third's layer stays while it is off, to animate in. */
  on?: boolean;
  /** Drawn faintly, behind the element the layout editor has selected. */
  dimmed?: boolean;
  /**
   * How a board keeps its lines clear of the timers on its top-right corner: their column kept clear, or its
   * top row under them. None when no timer sits there.
   */
  timerClearance?: LiveOverlayTimerClearance;
  /** Up next inside the scene's background: it reads on the background, without a plate of its own. */
  onGround?: boolean;
  placement: LiveOverlayElementPlacement;
  children: ComponentChildren;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<OverlayRect>(FULL_FRAME);
  // A graphic moves only from where it stood: one that comes on as the scene changes appears in its box.
  const stood = useRef(false);
  // And only at the size it had: in a box of another size it is set again, so it cuts to that box at once,
  // and never shows a frame set for the new box inside the old one.
  const size = useRef({ w: placement.w, h: placement.h });
  const resized = useRef(false);
  if (size.current.w !== placement.w || size.current.h !== placement.h) {
    size.current = { w: placement.w, h: placement.h };
    resized.current = true;
  }
  if (!moving) {
    stood.current = on;
    resized.current = false;
  }
  useLayoutEffect(() => {
    const read = () => {
      const shell = surface.current?.firstElementChild;
      if (!(shell instanceof HTMLElement)) return;
      // A positioning shell (the question's or poll's frame) is measured by the card it holds, so the card fills its box.
      const card = shell.dataset.overlayShell !== undefined ? shell.firstElementChild : null;
      const node = card instanceof HTMLElement ? card : shell;
      if (!node.offsetWidth || !node.offsetHeight) return;
      const next = {
        x: node.offsetLeft + (node === shell ? 0 : shell.offsetLeft),
        y: node.offsetTop + (node === shell ? 0 : shell.offsetTop),
        width: node.offsetWidth,
        height: node.offsetHeight,
      };
      setBounds((current) =>
        (Object.keys(next) as Array<keyof OverlayRect>).every((key) => current[key] === next[key]) ? current : next,
      );
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    if (surface.current) observer.observe(surface.current);
    const shell = surface.current?.firstElementChild;
    if (shell) observer.observe(shell);
    if (shell?.firstElementChild) observer.observe(shell.firstElementChild);
    return () => observer.disconnect();
  }, [children]);
  const transform = liveOverlayLayerTransform(placement, bounds);
  // The move and scale are measured, so they reach the stylesheet as custom properties rather than markup.
  useLayoutEffect(() => {
    const node = surface.current;
    if (!node) return;
    for (const [name, value] of [
      ["--overlay-dx", `${transform.dx}px`],
      ["--overlay-dy", `${transform.dy}px`],
      ["--overlay-scale", String(transform.scale)],
      ["--overlay-timer-inline", String(timerClearance.inline)],
      ["--overlay-timer-block", String(timerClearance.block)],
    ])
      node.style.setProperty(name, value);
  }, [transform.dx, transform.dy, transform.scale, timerClearance.inline, timerClearance.block]);
  // So does the stack order: the document's order never changes, the stylesheet stacks the layers.
  useLayoutEffect(() => {
    layer.current?.style.setProperty("--overlay-order", String(order));
  }, [order]);
  return (
    <div
      ref={layer}
      class="pk-live-overlay__layer"
      data-overlay-element={element}
      data-dimmed={dimmed ? "" : undefined}
      data-timer-clearance={timerClearance.block > 0 ? "below" : timerClearance.inline > 0 ? "beside" : undefined}
      data-on-ground={onGround ? "" : undefined}
    >
      <div
        ref={surface}
        class="pk-live-overlay__surface"
        data-placed={transform.identity ? undefined : ""}
        data-moving={moving && on && stood.current && !resized.current ? "" : undefined}
      >
        {children}
      </div>
    </div>
  );
}
