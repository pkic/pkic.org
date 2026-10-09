/**
 * BottomSheet — a modal sheet that rises from the bottom edge of a phone.
 *
 * Built on the native `<dialog>` opened with `showModal()`, like Dialog: the
 * platform traps focus, makes the page behind it inert, closes it on Escape
 * and returns focus to the control that opened it. The sheet adds what a
 * thumb expects: a visible handle that can be dragged down to dismiss it, a
 * tap on the dimmed page behind it to dismiss it, and an explicit Close
 * button for anyone who neither swipes nor has an Escape key.
 *
 * It is controlled: every way of dismissing it calls `onClose`, and the
 * parent's `open` decides whether the dialog is shown.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import { Button } from "./Button";
import { IconRemove } from "./MediaIcons";
import { useVerticalSwipe } from "./use-vertical-swipe";
import "./BottomSheet.css";

/** How far the handle must travel down before letting go dismisses the sheet. */
const DISMISS_PX = 64;

export function BottomSheet({
  id,
  open,
  title,
  onClose,
  closeLabel = "Close",
  children,
}: {
  id?: string;
  open: boolean;
  title: string;
  onClose: () => void;
  closeLabel?: string;
  children?: ComponentChildren;
}) {
  const titleId = `${useId()}-title`;
  const ref = useRef<HTMLDialogElement>(null);
  const drag = (travel: number) => {
    const dialog = ref.current;
    if (!dialog) return;
    // Follows the finger; the stylesheet turns the transition off while dragging.
    dialog.style.setProperty("--pk-sheet-drag", `${travel}px`);
    dialog.toggleAttribute("data-dragging", travel > 0);
  };
  const swipe = useVerticalSwipe({ direction: "down", threshold: DISMISS_PX, onDrag: drag, onSwipe: onClose });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      drag(0);
      dialog.showModal();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Escape is the platform's close request; the parent's state decides, so the sheet never closes behind its back.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", onClose);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", onClose);
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      id={id}
      class="pk-sheet"
      aria-labelledby={titleId}
      // The dialog box is filled by its panel, so a click on the dialog itself landed on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div class="pk-sheet__panel">
        <div class="pk-sheet__grip" {...swipe}>
          <span class="pk-sheet__handle" aria-hidden="true" />
          <div class="pk-sheet__head">
            <h2 class="pk-sheet__title" id={titleId}>
              {title}
            </h2>
            <Button variant="ghost" size="sm" icon aria-label={closeLabel} onClick={onClose}>
              <IconRemove />
            </Button>
          </div>
        </div>
        <div class="pk-sheet__body">{children}</div>
      </div>
    </dialog>
  );
}
