import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

/**
 * While a popup is open, a press anywhere outside its root closes it. The
 * listener runs in the capture phase, so a press that something else stops
 * still closes the popup.
 */
export function usePressOutside(open: boolean, rootRef: RefObject<HTMLElement>, onOutside: () => void): void {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOutside();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open, rootRef, onOutside]);
}
