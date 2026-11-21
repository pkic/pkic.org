import type { RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  claimSurface,
  describeBy,
  hinted,
  takeSurfaceTitles,
  takeTitle,
  takeTitles,
  worthShowing,
} from "./control-tooltip-hints";
import { usePopupPlacement } from "./popup-placement";
import "./ControlTooltips.css";

/** The gap the placement keeps to the viewport's edge. */
const EDGE = 8;

/** A hint's first line leads when it has more: what the control is and its state, then what a click does. */
function HintText({ id, text }: { id: string; text: string }) {
  const [lead, ...rest] = text.split("\n");
  if (!rest.length) return <>{text}</>;
  return (
    <>
      <strong class="pk-control-tooltip__lead">{lead}</strong>
      <span id={`${id}-more`} class="pk-control-tooltip__more">
        {rest.map((line, index) => (
          <span key={index}>{line}</span>
        ))}
      </span>
    </>
  );
}

/**
 * Shows every control's hint on a surface as the design system's tooltip, at
 * once on hover and on keyboard focus, instead of the browser's plain title.
 * The surface is the scope's element and every dialog, menu and popover laid
 * over it. The controls keep writing `title`; this layer takes it as soon as
 * it is written, so the browser's own never shows, and follows it as it
 * changes. The tooltip stands in the browser's top layer, above an open
 * dialog. A touch never opens one, since a tap acts.
 */
export function ControlTooltips({ scope }: { scope: RefObject<HTMLElement> }) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  // Where the pointer came onto the control, when a pointer opened the hint.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // `shown` counts every showing, so the same words on another control are placed and raised again. A menu
  // item's hint stands beside the menu, as a submenu would, so it never covers the items above it.
  const [hint, setHint] = useState<{ text: string; shown: number; side: "top" | "left" | "right" } | null>(null);
  const current = useRef<string | null>(null);
  const showings = useRef(0);
  useLayoutEffect(() => {
    const element = popup.current;
    if (!hint || !element || typeof element.showPopover !== "function") return;
    // The top layer draws its newest entry on top: shown again, the hint stands above a dialog or menu opened since.
    element.setAttribute("popover", "manual");
    if (element.matches(":popover-open")) element.hidePopover();
    element.showPopover();
  }, [hint]);
  /** Keeps the placed hint near the pointer on a wide control, and never under it. */
  const settle = useCallback(() => {
    const element = popup.current;
    const target = anchor.current;
    const at = pointer.current;
    if (!element || !target || !at || target.closest('[role="menu"]')) return;
    const box = element.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    let { left, top } = box;
    if (rect.width > box.width) left = Math.min(Math.max(at.x - box.width / 2, rect.left), rect.right - box.width);
    left = Math.max(EDGE, Math.min(left, window.innerWidth - box.width - EDGE));
    if (at.x >= left && at.x <= left + box.width && at.y >= top && at.y <= top + box.height)
      top = at.y - box.height - 2 * EDGE >= EDGE ? at.y - box.height - 2 * EDGE : at.y + 3 * EDGE;
    element.style.setProperty("left", `${left}px`);
    element.style.setProperty("top", `${top}px`);
  }, []);
  usePopupPlacement({
    open: hint !== null,
    anchorRef: anchor,
    popupRef: popup,
    side: hint?.side ?? "top",
    revision: hint ? `${hint.shown}:${hint.text}` : undefined,
    matchAnchorWidth: false,
    afterPlace: settle,
  });
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const release = claimSurface(root);
    // The control pressed last, which keeps quiet until the pointer has left it.
    let pressed: HTMLElement | null = null;
    const undescribe = () => {
      if (anchor.current?.getAttribute("aria-describedby")?.startsWith(id))
        anchor.current.removeAttribute("aria-describedby");
    };
    const hide = () => {
      undescribe();
      anchor.current = null;
      current.current = null;
      setHint(null);
    };
    const show = (element: HTMLElement) => {
      takeTitle(element);
      const text = element.dataset.tooltip;
      if (!text || !worthShowing(element, text)) return hide();
      if (anchor.current !== element) undescribe();
      anchor.current = element;
      describeBy(element, id);
      current.current = text;
      const menu = element.closest('[role="menu"]')?.getBoundingClientRect();
      const side = !menu ? "top" : menu.left + menu.width / 2 > window.innerWidth / 2 ? "left" : "right";
      setHint({ text, shown: ++showings.current, side });
    };
    takeSurfaceTitles(root);
    const observer = new MutationObserver((records) => {
      let opened: Node | null = null;
      for (const record of records) {
        // The tooltip showing is itself a popover opening; it is not an overlay over its own control.
        if (record.target === popup.current) continue;
        if (record.type === "childList") record.addedNodes.forEach((node) => takeTitles(root, node));
        else {
          takeTitles(root, record.target);
          if (record.attributeName !== "title") opened = record.target;
        }
      }
      const element = anchor.current;
      if (!element) return;
      // Gone, hidden with its dialog, or left behind an overlay that opened: the hint goes with it.
      if (!element.isConnected || element.checkVisibility?.() === false) hide();
      else if (opened && !opened.contains(element)) hide();
      else if (opened || element.dataset.tooltip !== current.current) show(element);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["title", "popover", "open"],
    });
    const over = (event: PointerEvent) => {
      // A touch acts, and a drag passes over controls it is not about.
      if (event.pointerType === "touch" || event.buttons) return;
      const element = hinted(root, event.target);
      if (element !== pressed) pressed = null;
      if (element === anchor.current || (element && element === pressed)) return;
      if (element) {
        pointer.current = { x: event.clientX, y: event.clientY };
        show(element);
      } else if (pointer.current) hide();
    };
    const out = (event: PointerEvent) => {
      // A hint the keyboard opened stays while the pointer wanders elsewhere.
      if (!pointer.current || hinted(root, event.relatedTarget) === anchor.current) return;
      hide();
    };
    const down = (event: PointerEvent) => {
      pressed = hinted(root, event.target);
      hide();
    };
    const focus = (event: FocusEvent) => {
      const element = hinted(root, event.target);
      pointer.current = null;
      if (element?.matches(":focus-visible")) show(element);
      else hide();
    };
    const blur = (event: FocusEvent) => {
      if (event.target instanceof Node && anchor.current?.contains(event.target)) hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    // Only a scroll that moves the control takes its hint away; a chat scrolling by itself does not.
    const scroll = (event: Event) => {
      if (anchor.current && event.target instanceof Node && event.target.contains(anchor.current)) hide();
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    return () => {
      observer.disconnect();
      release();
      hide();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [scope, id]);
  if (hint === null) return null;
  return createPortal(
    <div ref={popup} id={id} role="tooltip" class="pk-control-tooltip">
      <HintText id={id} text={hint.text} />
    </div>,
    document.body,
  );
}
