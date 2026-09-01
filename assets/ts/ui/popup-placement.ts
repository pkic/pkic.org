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
