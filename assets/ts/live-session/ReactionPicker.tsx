/**
 * ReactionPicker — the "add a reaction" control on a chat message.
 *
 * The trigger opens a small popover with one horizontal row of emoji, the shape every chat app uses for
 * reactions. It is a toolbar rather than a menu: the choices are independent on/off toggles, so each carries
 * `aria-pressed` for the reactions the viewer already added. Placement and the top layer are the shared popup
 * policy; the keyboard contract is arrows/Home/End within the row, Escape back to the trigger, Tab out.
 */

import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useId, useRef, useState } from "preact/hooks";

import { usePopupPlacement } from "../ui/popup-placement";
import "../ui/Menu.css";
import "./ReactionPicker.css";
import { ReactionToolbar, type ReactionChoice } from "./ReactionToolbar";

export type { ReactionChoice } from "./ReactionToolbar";

export function ReactionPicker({
  label,
  title,
  triggerClass,
  reactions,
  pressed,
  onReact,
  children,
}: {
  /** Accessible name for the trigger. */
  label: string;
  title?: string;
  triggerClass?: string;
  reactions: readonly ReactionChoice[];
  /** The ids of the reactions the viewer has already added. */
  pressed: readonly string[];
  /** Called with the reaction and whether it should now be on. */
  onReact: (reaction: string, on: boolean) => void;
  /** Trigger content. */
  children?: ComponentChildren;
}) {
  const popupId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  usePopupPlacement({ open, anchorRef: triggerRef, popupRef, align: "end", side: "top", topLayer: true });

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open, close]);

  return (
    <div class="pk-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        class={["pk-menu__trigger", "pk-menu__trigger--plain", triggerClass].filter(Boolean).join(" ")}
        aria-label={label}
        title={title}
        aria-haspopup="true"
        aria-expanded={open ? "true" : "false"}
        aria-controls={open ? popupId : undefined}
        onClick={() => {
          if (open) close(true);
          else setOpen(true);
        }}
      >
        {children}
      </button>
      {open && (
        <ReactionToolbar
          id={popupId}
          toolbarRef={popupRef}
          label="Reactions"
          class="pk-reaction-picker"
          reactions={reactions}
          pressed={pressed}
          autoFocus
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              close(true);
            } else if (event.key === "Tab") close(false);
          }}
          onChoose={(reaction, on) => {
            close(true);
            onReact(reaction.id, on);
          }}
        />
      )}
    </div>
  );
}
