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

export interface PopupSpacing {
  gap?: number;
  crossAxis?: number;
}

export interface PopupPosition {
  top: number;
  left: number;
  minWidth: number;
  /** Set only for a popup that keeps its anchor visible and fits on neither side: it scrolls on the roomier side. */
  maxHeight?: number;
}

export function measurePopupPosition(
  anchor: DOMRect,
  popup: DOMRect,
  align: "start" | "end" = "start",
  side: "bottom" | "top" | "right" | "left" = "bottom",
  spacing?: PopupSpacing,
  keepAnchorVisible = false,
): PopupPosition {
  const horizontal = side === "right" || side === "left";
  const gap = spacing?.gap ?? (horizontal ? 8 : 4);
  const margin = 8;
  const viewport = window.visualViewport;
  const viewportTop = viewport?.offsetTop ?? 0;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
  const viewportRight = viewportLeft + (viewport?.width ?? window.innerWidth);

  const roomBelow = viewportBottom - margin - (anchor.bottom + gap);
  const roomAbove = anchor.top - gap - (viewportTop + margin);
  const fitsBelow = popup.height <= roomBelow;
  const fitsAbove = popup.height <= roomAbove;
  /*
   * A phone keyboard leaves a short visible viewport, often too short for a field's matches on either side.
   * Clamping them into the viewport laid them over the field, so the reader could no longer see what they
   * typed. A popup that keeps its anchor visible takes the roomier side and scrolls there instead. Cards and
   * tours that point at a large subject keep overlapping it: capped beside it they would shrink to nothing.
   */
  const maxHeight =
    keepAnchorVisible && !horizontal && !fitsBelow && !fitsAbove ? Math.max(0, roomAbove, roomBelow) : undefined;
  const height = maxHeight ?? popup.height;
  const above = anchor.top - gap - height;
  const below = anchor.bottom + gap;
  // A popup that prefers the top opens above its anchor, as a reaction bar does, and drops below only without room.
  const top = horizontal
    ? anchor.top + (spacing?.crossAxis ?? 0)
    : maxHeight !== undefined
      ? roomAbove > roomBelow
        ? above
        : below
      : side === "top"
        ? fitsAbove || !fitsBelow
          ? above
          : below
        : !fitsBelow && fitsAbove
          ? above
          : below;

  const preferred =
    side === "left"
      ? anchor.left - gap - popup.width >= viewportLeft + margin
        ? anchor.left - gap - popup.width
        : anchor.right + gap
      : side === "right"
        ? anchor.right + gap + popup.width <= viewportRight - margin
          ? anchor.right + gap
          : anchor.left - gap - popup.width
        : align === "end"
          ? anchor.right - popup.width
          : anchor.left;
  const left = Math.max(viewportLeft + margin, Math.min(preferred, viewportRight - popup.width - margin));

  return {
    top: Math.max(viewportTop + margin, Math.min(top, viewportBottom - height - margin)),
    left,
    minWidth: horizontal ? 0 : anchor.width,
    ...(maxHeight === undefined ? {} : { maxHeight }),
  };
}

/** Writes a measured position onto the popup element. */
export function applyPopupPosition(popup: HTMLElement, position: PopupPosition): void {
  popup.style.setProperty("top", `${position.top}px`);
  popup.style.setProperty("left", `${position.left}px`);
  // Never narrower than what it hangs from, so a wide trigger does not
  // sprout a thin popup off one corner.
  popup.style.setProperty("min-width", `${position.minWidth}px`);
  if (position.maxHeight === undefined) {
    popup.style.removeProperty("max-height");
    popup.style.removeProperty("overflow-y");
  } else {
    popup.style.setProperty("max-height", `${position.maxHeight}px`);
    popup.style.setProperty("overflow-y", "auto");
  }
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
  topLayer = false,
  anchorPoint,
  spacing,
  beforePlace,
  afterPlace,
  matchAnchorWidth = true,
  keepAnchorVisible = false,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement>;
  popupRef: RefObject<HTMLElement>;
  align?: "start" | "end";
  spacing?: PopupSpacing;
  side?: "bottom" | "top" | "right" | "left";
  /** Changes whenever the popup's measured size can have changed. */
  revision?: string | number;
  /**
   * Shows the popup in the browser's top layer, as a manual popover, before it is measured. A fixed popup is
   * still painted inside its ancestors' stacking contexts: a menu in an agenda card opened under the pinned room
   * headers and, on a phone, under the workspace tabs. The top layer is above every page context, and the popup
   * stays where it is in the document, so focus, keyboard handling and outside clicks are unchanged.
   */
  topLayer?: boolean;
  /** A pointer or caret position for a context menu, using the same viewport placement policy. */
  anchorPoint?: { x: number; y: number } | (() => { x: number; y: number } | null) | null;
  /** Position an anchored parent before measuring its child, regardless of event-listener order. */
  beforePlace?: () => void;
  /** Update dependent decorations after every placement, including viewport and frame updates. */
  afterPlace?: () => void;
  /** Coach marks may point to a wide subject without becoming equally wide. */
  matchAnchorWidth?: boolean;
  /**
   * A field's matches never cover the field: without room on either side they scroll on the roomier side. Off
   * for cards and tours, which may overlap a subject too large to sit beside.
   */
  keepAnchorVisible?: boolean;
}): () => void {
  const gap = spacing?.gap;
  const crossAxis = spacing?.crossAxis;
  const place = useCallback((): void => {
    beforePlace?.();
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    const point = typeof anchorPoint === "function" ? anchorPoint() : anchorPoint;
    if ((!anchor && !point) || !popup) return;
    const anchorRect = point ? new DOMRect(point.x, point.y, 0, 0) : anchor!.getBoundingClientRect();
    popup.style.setProperty(
      "min-width",
      `${!matchAnchorWidth || side === "right" || side === "left" ? 0 : anchorRect.width}px`,
    );
    // Measured at its natural height, not a cap from an earlier pass. The scroll that re-places the popup may be
    // the reader's own scroll through it, and dropping the cap would reset that, so its position is kept.
    const scrollTop = popup.scrollTop;
    if (keepAnchorVisible) popup.style.removeProperty("max-height");
    const position = measurePopupPosition(
      anchorRect,
      popup.getBoundingClientRect(),
      align,
      side,
      { gap, crossAxis },
      keepAnchorVisible,
    );
    if (!matchAnchorWidth) position.minWidth = 0;
    applyPopupPosition(popup, position);
    if (popup.scrollTop !== scrollTop) popup.scrollTop = scrollTop;
    afterPlace?.();
  }, [
    align,
    anchorRef,
    popupRef,
    side,
    anchorPoint,
    gap,
    crossAxis,
    beforePlace,
    afterPlace,
    matchAnchorWidth,
    keepAnchorVisible,
  ]);

  useLayoutEffect(() => {
    if (!open) return;
    const popup = popupRef.current;
    if (topLayer && popup && typeof popup.showPopover === "function" && !popup.hasAttribute("popover")) {
      popup.setAttribute("popover", "manual");
      popup.showPopover();
    }
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
  }, [open, place, revision, anchorRef, popupRef, topLayer]);

  // A fixed popup does not move with its anchor, so it is re-placed as the
  // page moves. Closing instead would mean any scroll momentum — unavoidable
  // on a touch screen — eats the popup on the way to it.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", place);
    viewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      viewport?.removeEventListener("resize", place);
      viewport?.removeEventListener("scroll", place);
    };
  }, [open, place]);
  return place;
}
