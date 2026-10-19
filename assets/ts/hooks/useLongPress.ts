import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

/** A press held this long is a long press rather than a tap. */
export const LONG_PRESS_MS = 500;

/**
 * Touch-and-hold on a control that also has a tap. Spread `handlers` on the
 * control and call `tapped()` at the start of its click: it is false for the
 * click that ends a long press, so the hold does not also count as a tap.
 */
export function useLongPress(onLongPress: () => void): {
  handlers: Pick<
    JSX.HTMLAttributes<HTMLElement>,
    "onPointerDown" | "onPointerUp" | "onPointerLeave" | "onPointerCancel" | "onContextMenu"
  >;
  tapped: () => boolean;
} {
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const latest = useRef(onLongPress);
  latest.current = onLongPress;
  const cancel = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  return {
    handlers: {
      onPointerDown: () => {
        cancel();
        held.current = false;
        timer.current = window.setTimeout(() => {
          timer.current = null;
          held.current = true;
          latest.current();
        }, LONG_PRESS_MS);
      },
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      // A held finger opens the browser's own menu otherwise.
      onContextMenu: (event) => event.preventDefault(),
    },
    tapped: () => {
      const wasHeld = held.current;
      held.current = false;
      return !wasHeld;
    },
  };
}
