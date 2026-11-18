import type { RefObject } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { usePopupPlacement } from "./popup-placement";
import "./ControlTooltips.css";

/** A dialog keeps the browser's own titles: the tooltip layer draws under the top layer. */
const outsideDialog = (element: Element) => !element.closest("dialog");

/** The element whose hint applies, or null: a hinted element in the scope, not in a dialog. */
function hinted(scope: HTMLElement, target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>("[title], [data-tooltip]");
  if (!element || !scope.contains(element) || !outsideDialog(element)) return null;
  return element;
}

/** Whether something other than its title names the control. */
const namedOtherwise = (element: HTMLElement) =>
  element.hasAttribute("aria-labelledby") ||
  (element.hasAttribute("aria-label") && !("tooltipNames" in element.dataset)) ||
  Boolean(element.textContent?.trim());

/**
 * Moves the element's title into its hint, so the browser's own title never
 * shows. A control the title alone named keeps that name; otherwise the hint
 * stays its description for assistive technology. Runs again whenever the
 * control writes a new title, so the hint always says the current state.
 */
function takeTitle(element: HTMLElement) {
  const title = element.getAttribute("title");
  if (title === null || !outsideDialog(element)) return;
  element.removeAttribute("title");
  element.dataset.tooltip = title;
  const spoken = title.replaceAll("\n", ". ");
  if ("tooltipNames" in element.dataset || !namedOtherwise(element)) {
    element.dataset.tooltipNames = "";
    if (spoken) element.setAttribute("aria-label", spoken);
    else element.removeAttribute("aria-label");
  } else if (
    "tooltipDescribes" in element.dataset ||
    (!element.hasAttribute("aria-description") && element.getAttribute("aria-label") !== spoken)
  ) {
    element.dataset.tooltipDescribes = "";
    if (spoken) element.setAttribute("aria-description", spoken);
    else element.removeAttribute("aria-description");
  }
}

/** Every titled element in this subtree, itself included. */
function takeTitles(node: Node) {
  if (!(node instanceof HTMLElement)) return;
  if (node.hasAttribute("title")) takeTitle(node);
  node.querySelectorAll<HTMLElement>("[title]").forEach(takeTitle);
}

/** A hint's first line leads when it has more: what the control is and its state, then what a click does. */
function HintText({ text }: { text: string }) {
  const [lead, ...rest] = text.split("\n");
  if (!rest.length) return <>{text}</>;
  return (
    <>
      <strong class="pk-control-tooltip__lead">{lead}</strong>
      {rest.map((line, index) => (
        <span key={index}>{line}</span>
      ))}
    </>
  );
}

/**
 * Shows every control's hint inside a scope as the design system's tooltip,
 * at once on hover and on keyboard focus, instead of the browser's plain
 * title. The controls keep writing `title`; this layer takes it as soon as it
 * is written, so the browser's own never shows, and follows it as it
 * changes. A touch never opens one, since a tap acts.
 */
export function ControlTooltips({ scope }: { scope: RefObject<HTMLElement> }) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);
  // The hint on show, which the observer compares with the control's newest one.
  const shown = useRef<string | null>(null);
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
    const hide = () => {
      anchor.current?.removeAttribute("aria-describedby");
      anchor.current = null;
      shown.current = null;
      setText(null);
    };
    const show = (element: HTMLElement) => {
      takeTitle(element);
      const hint = element.dataset.tooltip;
      if (!hint) return hide();
      if (anchor.current !== element) anchor.current?.removeAttribute("aria-describedby");
      anchor.current = element;
      element.setAttribute("aria-describedby", id);
      shown.current = hint;
      setText(hint);
    };
    takeTitles(root);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") takeTitles(record.target);
        else record.addedNodes.forEach(takeTitles);
      }
      const current = anchor.current;
      if (current && !current.isConnected) hide();
      else if (current && current.dataset.tooltip !== shown.current) show(current);
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const element = hinted(root, event.target);
      if (element === anchor.current) return;
      if (element) show(element);
      else hide();
    };
    const out = (event: PointerEvent) => {
      if (anchor.current && hinted(root, event.relatedTarget) === anchor.current) return;
      hide();
    };
    const focus = (event: FocusEvent) => {
      const element = hinted(root, event.target);
      if (element?.matches(":focus-visible")) show(element);
      else hide();
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
      observer.disconnect();
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
      <HintText text={text} />
    </div>,
    document.body,
  );
}
