/**
 * ReactionPicker — the "add a reaction" control on a chat message.
 *
 * The trigger opens a small popover with one horizontal row of emoji, the shape every chat app uses for
 * reactions. It is a toolbar rather than a menu: the choices are independent on/off toggles, so each carries
 * `aria-pressed` for the reactions the viewer already added. Placement and the top layer are the shared popup
 * policy; the keyboard contract is arrows/Home/End within the row, Escape back to the trigger, Tab out.
 */

import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";

import { usePopupPlacement } from "../ui/popup-placement";
import "../ui/Menu.css";
import "./ReactionPicker.css";

export interface ReactionChoice {
  id: string;
  label: string;
  emoji: string;
}

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
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  useLayoutEffect(() => {
    if (open) buttonRefs.current[active]?.focus({ preventScroll: true });
  }, [open, active]);

  function keyDown(event: KeyboardEvent) {
    event.stopPropagation();
    const last = reactions.length - 1;
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        setActive(active >= last ? 0 : active + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        setActive(active <= 0 ? last : active - 1);
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(last);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  }

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
          else {
            setActive(0);
            setOpen(true);
          }
        }}
      >
        {children}
      </button>
      {open && (
        <div
          ref={popupRef}
          id={popupId}
          role="toolbar"
          aria-label="Reactions"
          aria-orientation="horizontal"
          class="pk-reaction-picker"
          onKeyDown={keyDown}
        >
          {reactions.map((reaction, index) => {
            const on = pressed.includes(reaction.id);
            return (
              <button
                key={reaction.id}
                ref={(element) => {
                  buttonRefs.current[index] = element;
                }}
                type="button"
                class="pk-reaction-picker__button"
                aria-label={reaction.label}
                aria-pressed={on ? "true" : "false"}
                title={reaction.label}
                tabIndex={index === active ? 0 : -1}
                onClick={() => {
                  close(true);
                  onReact(reaction.id, !on);
                }}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
