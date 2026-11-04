import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { usePopupPlacement } from "./popup-placement";
import "./Tooltip.css";

/** Descriptive help available on hover, keyboard focus and tap, without trapping focus. */
export function Tooltip({
  label,
  content,
  children,
}: {
  label: string;
  content: ComponentChildren;
  children: ComponentChildren;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout>>();
  const show = () => {
    clearTimeout(closing.current);
    setOpen(true);
  };
  const hide = () => {
    closing.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => clearTimeout(closing.current), []);
  usePopupPlacement({ open, anchorRef: trigger, popupRef: popup, side: "top" });
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("keydown", dismiss);
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("keydown", dismiss);
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  return (
    <span class="pk-tooltip" onPointerEnter={show} onPointerLeave={hide}>
      <button
        ref={trigger}
        type="button"
        class="pk-tooltip__trigger"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onFocus={show}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.stopPropagation();
          show();
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="tooltip"
            class="pk-tooltip__content"
            onPointerEnter={show}
            onPointerLeave={hide}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
