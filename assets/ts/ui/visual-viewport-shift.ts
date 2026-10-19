/**
 * Keeps the app chrome on the part of the page the reader can actually see.
 *
 * Fixed and sticky chrome is placed against the layout viewport. Mobile Safari
 * can leave the visual viewport offset inside it after its toolbar collapses
 * or the on-screen keyboard closes (`visualViewport.offsetTop` stays above
 * zero), which draws the sticky header under the browser's own bar and lifts
 * the bottom tab bar off the screen edge with the page showing beneath it.
 *
 * This publishes how far the visible area is shifted as two custom properties
 * on the root element, which the chrome's stylesheets add to their offsets:
 *
 * - `--pk-viewport-shift-top`: how far below the layout viewport's top edge
 *   the visible area starts.
 * - `--pk-viewport-shift-bottom`: how far above the layout viewport's bottom
 *   edge the visible area ends; negative when it ends below it.
 *
 * Both stay zero while the reader is pinch-zoomed or typing, where the browser's
 * own placement is the expected one: a zoomed page pans under fixed chrome, and
 * the bottom bar does not ride above the keyboard.
 */

export interface ViewportShift {
  readonly top: number;
  readonly bottom: number;
}

interface VisualViewportLike {
  readonly offsetTop: number;
  readonly height: number;
  readonly scale: number;
}

const NO_SHIFT: ViewportShift = { top: 0, bottom: 0 };

/** The shift of the visible area within a layout viewport `layoutHeight` tall. */
export function visualViewportShift(
  layoutHeight: number,
  viewport: VisualViewportLike | null | undefined,
  editing: boolean,
): ViewportShift {
  if (!viewport || editing || Math.abs(viewport.scale - 1) > 0.01) return NO_SHIFT;
  const top = Math.max(0, Math.round(viewport.offsetTop));
  const bottom = Math.round(layoutHeight - (viewport.offsetTop + viewport.height));
  return { top, bottom };
}

function editingText(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) {
    return !["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(
      element.type,
    );
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/** Tracks the visible area until the returned function is called. */
export function trackVisualViewportShift(view: Window = window): () => void {
  const viewport = view.visualViewport;
  const root = view.document.documentElement;
  let frame = 0;
  const publish = () => {
    frame = 0;
    const shift = visualViewportShift(view.innerHeight, viewport, editingText(view.document.activeElement));
    root.style.setProperty("--pk-viewport-shift-top", `${shift.top}px`);
    root.style.setProperty("--pk-viewport-shift-bottom", `${shift.bottom}px`);
  };
  const schedule = () => {
    if (!frame) frame = view.requestAnimationFrame(publish);
  };
  publish();
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  view.addEventListener("resize", schedule);
  view.addEventListener("scroll", schedule, { passive: true });
  view.document.addEventListener("focusin", schedule);
  view.document.addEventListener("focusout", schedule);
  return () => {
    if (frame) view.cancelAnimationFrame(frame);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    view.removeEventListener("resize", schedule);
    view.removeEventListener("scroll", schedule);
    view.document.removeEventListener("focusin", schedule);
    view.document.removeEventListener("focusout", schedule);
    root.style.removeProperty("--pk-viewport-shift-top");
    root.style.removeProperty("--pk-viewport-shift-bottom");
  };
}
