/**
 * Viewport placement for a popup anchored to a trigger.
 *
 * One implementation, because there is one policy: below the anchor by
 * default, above only when below does not fit AND above does (flipping into
 * an even smaller gap would be worse than overflowing), clamped to an 8px
 * viewport margin, never narrower than the anchor. `Menu` wrote it first;
 * `ServerSearchSelect` copied it verbatim for its listbox, and the
 * duplication gate rightly refused the copy — a popup that places itself
 * differently from the menus is a bug report waiting to be written.
 *
 * The values are applied imperatively rather than as a `style` attribute:
 * viewport geometry is nothing a stylesheet can express, and the repository
 * forbids style attributes in markup. CSS anchor positioning replaces this
 * once Firefox ships it.
 */

import type { RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useState } from "preact/hooks";

export interface PopupPosition {
  top: number;
  left: number;
  minWidth: number;
}

export function measurePopupPosition(anchor: DOMRect, popup: DOMRect, align: "start" | "end" = "start"): PopupPosition {
  const gap = 4;
  const margin = 8;

  const fitsBelow = anchor.bottom + gap + popup.height <= window.innerHeight - margin;
  const fitsAbove = anchor.top - gap - popup.height >= margin;
  const top = !fitsBelow && fitsAbove ? anchor.top - gap - popup.height : anchor.bottom + gap;

  const preferred = align === "end" ? anchor.right - popup.width : anchor.left;
  const left = Math.max(margin, Math.min(preferred, window.innerWidth - popup.width - margin));

  return { top: Math.max(margin, top), left, minWidth: anchor.width };
}

/** Writes a measured position onto the popup element. */
export function applyPopupPosition(popup: HTMLElement, position: PopupPosition): void {
  popup.style.setProperty("top", `${position.top}px`);
  popup.style.setProperty("left", `${position.left}px`);
  // Never narrower than what it hangs from, so a wide trigger does not
  // sprout a thin popup off one corner.
  popup.style.setProperty("min-width", `${position.minWidth}px`);
}

/**
 * The placement policy, wired to a popup's lifetime.
 *
 * Placement is not just the arithmetic above: it is also *when* the
 * arithmetic runs — once the popup is in the document and can be measured,
 * again whenever its contents change size, and again on every resize or
 * scroll underneath it. Three components need exactly that sequence, and
 * three hand-written copies of it is how one of them ended up with a popup
 * that could hang below the viewport: `UserPicker` wrote a shorter version
 * that placed the popup at `anchor.bottom + 4` unconditionally, with no flip
 * and no clamp. Below the fold that put the matches off-screen, where they
 * could be seen but never clicked.
 *
 * `open` gates everything; `revision` is any value that changes when the
 * popup's own size can have changed, which is what forces a re-measure.
 */
export function usePopupPlacement({
  open,
  anchorRef,
  popupRef,
  align = "start",
  revision,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  popupRef: RefObject<HTMLElement>;
  align?: "start" | "end";
  /** Changes whenever the popup's measured size can have changed. */
  revision?: string | number;
}): void {
  const [position, setPosition] = useState<PopupPosition | null>(null);

  const measure = useCallback((): PopupPosition | null => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!anchor || !popup) return null;
    return measurePopupPosition(anchor.getBoundingClientRect(), popup.getBoundingClientRect(), align);
  }, [align, anchorRef, popupRef]);

  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup || !position) return;
    applyPopupPosition(popup, position);
  }, [popupRef, position]);

  // Measured once the popup is in the document — the first render after
  // opening, when there is finally a box to measure — and again whenever its
  // contents change size underneath it.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    setPosition(measure());
  }, [open, measure, revision]);

  // A fixed popup does not move with its anchor, so it is re-placed as the
  // page moves. Closing instead would mean any scroll momentum — unavoidable
  // on a touch screen — eats the popup on the way to it.
  useEffect(() => {
    if (!open) return;
    const onReflow = () => setPosition(measure());
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, measure]);
}
