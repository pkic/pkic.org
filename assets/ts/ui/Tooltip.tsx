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
  const hovered = useRef(new Set<string>());
  const closing = useRef<ReturnType<typeof setTimeout>>();
  const show = () => {
    clearTimeout(closing.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(closing.current);
    if (document.activeElement === trigger.current || popup.current?.contains(document.activeElement)) return;
    closing.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => clearTimeout(closing.current), []);
  usePopupPlacement({ open, anchorRef: trigger, popupRef: popup, side: "top" });
  useEffect(() => {
    if (!open) {
      hovered.current.delete("popup");
      return;
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (popup.current?.contains(document.activeElement)) trigger.current?.focus();
        setOpen(false);
      }
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
    <span
      class="pk-tooltip"
      onPointerEnter={() => {
        hovered.current.add("trigger");
        show();
      }}
      onPointerLeave={() => {
        hovered.current.delete("trigger");
        hide();
      }}
    >
      <button
        ref={trigger}
        type="button"
        class="pk-tooltip__trigger"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            popup.current?.focus();
          }
        }}
        onFocus={show}
        onBlur={(event) => {
          if (!hovered.current.size && !popup.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
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
            tabIndex={0}
            onFocus={show}
            onBlur={(event) => {
              if (
                !hovered.current.size &&
                event.relatedTarget !== trigger.current &&
                !popup.current?.contains(event.relatedTarget as Node | null)
              )
                setOpen(false);
            }}
            class="pk-tooltip__content"
            onPointerEnter={() => {
              hovered.current.add("popup");
              show();
            }}
            onPointerLeave={() => {
              hovered.current.delete("popup");
              hide();
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
