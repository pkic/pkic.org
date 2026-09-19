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
import { useCallback, useEffect, useLayoutEffect } from "preact/hooks";

export interface PopupPosition {
  top: number;
  left: number;
  minWidth: number;
}

export function measurePopupPosition(
  anchor: DOMRect,
  popup: DOMRect,
  align: "start" | "end" = "start",
  side: "bottom" | "right" = "bottom",
): PopupPosition {
  const gap = side === "right" ? 8 : 4;
  const margin = 8;

  const fitsBelow = anchor.bottom + gap + popup.height <= window.innerHeight - margin;
  const fitsAbove = anchor.top - gap - popup.height >= margin;
  const top =
    side === "right" ? anchor.top : !fitsBelow && fitsAbove ? anchor.top - gap - popup.height : anchor.bottom + gap;

  const preferred =
    side === "right"
      ? anchor.right + gap + popup.width <= window.innerWidth - margin
        ? anchor.right + gap
        : anchor.left - gap - popup.width
      : align === "end"
        ? anchor.right - popup.width
        : anchor.left;
  const left = Math.max(margin, Math.min(preferred, window.innerWidth - popup.width - margin));

  return {
    top: Math.max(margin, Math.min(top, window.innerHeight - popup.height - margin)),
    left,
    minWidth: side === "right" ? 0 : anchor.width,
  };
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
 * Measuring and writing happen in **one** layout effect, with no state
 * between them. Holding the position in state cost a render: the popup was
 * mounted at whatever `position: fixed` with no `top`/`left` resolves to —
 * its static place inside the row — painted there, and only then moved to
 * the measured spot. That is the jump in issue #36. A layout effect runs
 * after the DOM is mutated and before the browser paints, so doing both
 * there means the popup is never painted anywhere but where it belongs.
 *
 * The order inside the effect matters too. `min-width` comes from the
 * anchor and can widen the popup, and a wider popup wraps less and is
 * therefore shorter — so it is written *before* the height that decides
 * whether the popup flips above the anchor is measured. Measuring first
 * decided the flip on a height the popup was about to stop having.
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
  side = "bottom",
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  popupRef: RefObject<HTMLElement>;
  align?: "start" | "end";
  side?: "bottom" | "right";
  /** Changes whenever the popup's measured size can have changed. */
  revision?: string | number;
}): void {
  const place = useCallback((): void => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!anchor || !popup) return;
    const anchorRect = anchor.getBoundingClientRect();
    popup.style.setProperty("min-width", `${side === "right" ? 0 : anchorRect.width}px`);
    applyPopupPosition(popup, measurePopupPosition(anchorRect, popup.getBoundingClientRect(), align, side));
  }, [align, anchorRef, popupRef, side]);

  useLayoutEffect(() => {
    if (!open) return;
    place();

    /*
     * And again once the browser has settled, because the first pass can
     * measure a page that is still moving.
     *
     * A layout effect runs before paint, which is what keeps the popup from
     * being seen at its static spot — but "before paint" is also before a
     * webfont swap has reflowed the popup's own text and before a table has
     * finished settling its column widths. Measured then, a row menu in the
     * users list came out 49px right of its trigger and stayed there: the
     * arithmetic was right and the rectangles it was given were about to stop
     * being true. Issue #36 is what that looks like to a reader.
     *
     * A second pass on the next frame corrects it, and the observer below
     * catches anything slower. Both re-run the same placement, so neither can
     * disagree with the first about where the popup belongs.
     */
    const frame = requestAnimationFrame(place);

    /*
     * The popup's own size is the thing most likely to change under it — a
     * font finishing, an item's label arriving. `revision` covers the changes
     * a caller knows about; this covers the ones it does not.
     */
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place());
    if (observer && popupRef.current) observer.observe(popupRef.current);
    if (observer && anchorRef.current) observer.observe(anchorRef.current);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [open, place, revision, anchorRef, popupRef]);

  // A fixed popup does not move with its anchor, so it is re-placed as the
  // page moves. Closing instead would mean any scroll momentum — unavoidable
  // on a touch screen — eats the popup on the way to it.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);
}
