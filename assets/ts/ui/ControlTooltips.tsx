import type { RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { usePopupPlacement } from "./popup-placement";
import "./ControlTooltips.css";

/** How long a pointer rests on a control before its tooltip shows; keyboard focus shows it at once. */
const HOVER_DELAY_MS = 400;

/** The element whose hint applies, or null: a titled element in the scope, not in a dialog, which keeps its own. */
function hinted(scope: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[title], [data-tooltip]");
  if (!element || !scope.contains(element) || element.closest("dialog")) return null;
  return element;
}

/**
 * Takes the element's title as its hint, once: the browser's own title would
 * show beside the tooltip. A control the title alone named keeps that name,
 * and the hint stays its description for assistive technology.
 */
function hintOf(element: HTMLElement): string {
  const title = element.getAttribute("title");
  if (title !== null) {
    element.removeAttribute("title");
    element.dataset.tooltip = title;
    const named =
      element.hasAttribute("aria-label") ||
      element.hasAttribute("aria-labelledby") ||
      Boolean(element.textContent?.trim());
    if (!named) element.setAttribute("aria-label", title);
    else if (!element.hasAttribute("aria-description") && element.getAttribute("aria-label") !== title)
      element.setAttribute("aria-description", title);
  }
  return element.dataset.tooltip ?? "";
}

/**
 * Shows every control's hint inside a scope as the design system's tooltip,
 * on hover and on keyboard focus, instead of the browser's plain title. The
 * controls keep writing `title`; this layer reads it. A touch never opens one,
 * since a tap acts.
 */
export function ControlTooltips({ scope }: { scope: RefObject<HTMLElement> }) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);
  usePopupPlacement({
    open: text !== null,
    anchorRef: anchor,
    popupRef: popup,
    side: "top",
    revision: text ?? undefined,
    matchAnchorWidth: false,
  });
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    let waiting: ReturnType<typeof setTimeout> | undefined;
    // The element under the pointer, waiting for its tooltip or showing it.
    let hovered: HTMLElement | null = null;
    const hide = () => {
      clearTimeout(waiting);
      hovered = null;
      anchor.current?.removeAttribute("aria-describedby");
      anchor.current = null;
      setText(null);
    };
    const show = (element: HTMLElement) => {
      const hint = hintOf(element);
      if (!hint) return;
      anchor.current = element;
      element.setAttribute("aria-describedby", id);
      setText(hint);
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const element = hinted(root, event.target);
      if (element && element === hovered) return;
      hide();
      if (!element) return;
      // Taken now, so the browser's own title never shows while the tooltip waits.
      hintOf(element);
      hovered = element;
      waiting = setTimeout(() => show(element), HOVER_DELAY_MS);
    };
    const out = (event: PointerEvent) => {
      if (hovered && hinted(root, event.relatedTarget) === hovered) return;
      hide();
    };
    const focus = (event: FocusEvent) => {
      const element = hinted(root, event.target);
      hide();
      if (element?.matches(":focus-visible")) show(element);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerout", out);
    root.addEventListener("pointerdown", hide);
    root.addEventListener("focusin", focus);
    root.addEventListener("focusout", hide);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("pointerdown", hide);
      root.removeEventListener("focusin", focus);
      root.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
    };
  }, [scope, id]);
  if (text === null) return null;
  return createPortal(
    <div ref={popup} id={id} role="tooltip" class="pk-control-tooltip">
      {text}
    </div>,
    document.body,
  );
}
