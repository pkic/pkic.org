/**
 * useVerticalSwipe — recognizes one vertical swipe on an element from its
 * pointer events, so touch, pen and mouse all drive it the same way.
 *
 * The gesture belongs to the element only once it is clearly vertical and in
 * the asked-for direction; a sideways or short movement stays an ordinary
 * tap. While dragging, `onDrag` reports how far the pointer travelled in the
 * swipe's direction (never negative), so a sheet can follow the finger; on
 * release short of the threshold it reports 0 again.
 *
 * A recognized swipe swallows the click the browser may still dispatch at its
 * end, so a swipe that starts on a link does not also follow it.
 */
import type { JSX } from "preact";
import { useRef } from "preact/hooks";

/** Travel before a movement counts as the swipe rather than a tap's jitter. */
const SLOP_PX = 6;

export interface VerticalSwipeOptions {
  direction: "up" | "down";
  onSwipe: () => void;
  onDrag?: (travel: number) => void;
  /** Travel, in CSS pixels, that completes the swipe. */
  threshold?: number;
}

type Handlers = Pick<
  JSX.HTMLAttributes<HTMLElement>,
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onClickCapture"
>;

export function useVerticalSwipe({ direction, onSwipe, onDrag, threshold = 32 }: VerticalSwipeOptions): Handlers {
  const start = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const swallowClick = useRef(false);
  const sign = direction === "up" ? -1 : 1;

  function travel(event: PointerEvent) {
    const origin = start.current!;
    return { along: sign * (event.clientY - origin.y), across: Math.abs(event.clientX - origin.x) };
  }

  return {
    onPointerDown(event) {
      // A secondary mouse button opens a context menu, not a gesture.
      if (event.pointerType === "mouse" && event.button !== 0) return;
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
      swallowClick.current = false;
    },
    onPointerMove(event) {
      const origin = start.current;
      if (!origin || event.pointerId !== origin.id) return;
      const { along, across } = travel(event);
      if (!origin.dragging && along > SLOP_PX && along > across) {
        origin.dragging = true;
        // Keep receiving the gesture once the finger leaves the element.
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }
      if (origin.dragging) onDrag?.(Math.max(0, along));
    },
    onPointerUp(event) {
      const origin = start.current;
      if (!origin || event.pointerId !== origin.id) return;
      const { along, across } = travel(event);
      start.current = null;
      if (along >= threshold && along > across) {
        swallowClick.current = true;
        onSwipe();
      } else if (origin.dragging) onDrag?.(0);
    },
    onPointerCancel(event) {
      const origin = start.current;
      if (!origin || event.pointerId !== origin.id) return;
      start.current = null;
      if (origin.dragging) onDrag?.(0);
    },
    onClickCapture(event) {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
