/**
 * ReactionPicker — the "add a reaction" control, on a chat message and on a phone's session reactions.
 *
 * The trigger opens a small popover with one horizontal row of emoji, the shape every chat app uses for
 * reactions. It is a toolbar rather than a menu. On a message the choices are on/off toggles, each with
 * `aria-pressed` for the reactions the viewer already added; without `pressed`, each choice simply sends.
 * Placement and the top layer are the shared popup policy; the keyboard contract is arrows/Home/End within
 * the row, Escape back to the trigger, Tab out.
 */

import type { ComponentChildren } from "preact";
import { useCallback, useId, useRef, useState } from "preact/hooks";

import { usePopupPlacement } from "../ui/popup-placement";
import "../ui/Menu.css";
import "./ReactionPicker.css";
import { ReactionToolbar, type ReactionChoice } from "./ReactionToolbar";
import { usePressOutside } from "../ui/use-press-outside";

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
  /** The ids of the reactions the viewer has already added. Left out, each choice is a plain action. */
  pressed?: readonly string[];
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

  const closeOutside = useCallback(() => close(false), [close]);
  usePressOutside(open, rootRef, closeOutside);

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
