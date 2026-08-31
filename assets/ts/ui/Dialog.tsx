/**
 * Dialog — a modal built on the native `<dialog>` element.
 *
 * Using `showModal()` rather than a hand-rolled overlay buys the three things
 * modals usually get wrong, from the platform: focus is trapped, the rest of
 * the page becomes inert to assistive technology, and Escape closes. None of
 * that has to be re-implemented or kept correct here.
 *
 * What is added on top:
 *
 *   - Focus returns to whatever opened the dialog. The platform does this for
 *     the element that called showModal(), but only if it is still in the
 *     document, so the opener is captured explicitly.
 *   - A destructive dialog can require the operator to type an exact phrase.
 *     That is not friction for its own sake: it is the difference between
 *     confirming "delete" in the abstract and confirming *which* thing.
 *   - Escape is intercepted when a typed confirmation is pending, so a stray
 *     keypress cannot dismiss a half-finished irreversible action... it still
 *     closes, but through the same cancel path as the button, so callers get
 *     one code path for "the operator backed out".
 */

import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useId, useRef, useState } from "preact/hooks";

import { Button } from "./Button";

import "./Dialog.css";

export interface DialogProps {
  open: boolean;
  title: string;
  /** Explains what will happen. One sentence. */
  description?: string;
  /** The specific, irreversible effects. Rendered as a list. */
  consequences?: readonly string[];
  /** Requires the operator to type this exactly before confirming. */
  confirmPhrase?: string;
  /** Label above the confirmation input. Ignored without `confirmPhrase`. */
  confirmPrompt?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ComponentChildren;
}

export function Dialog({
  open,
  title,
  description,
  consequences,
  confirmPhrase,
  confirmPrompt,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
  children,
}: DialogProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const ref = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);
  const [typed, setTyped] = useState("");

  const confirmable = !confirmPhrase || typed === confirmPhrase;

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener instanceof HTMLElement && document.contains(opener)) {
      opener.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      openerRef.current = document.activeElement;
      setTyped("");
      // jsdom implements <dialog> but not always showModal; fall back so the
      // component stays testable rather than testing a mock of itself.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // The platform fires `cancel` for Escape and the close request. Routing it
  // through onCancel gives callers a single "the operator backed out" path.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const onNativeCancel = (event: Event) => {
      event.preventDefault();
      restoreFocus();
      onCancel();
    };
    dialog.addEventListener("cancel", onNativeCancel);
    return () => dialog.removeEventListener("cancel", onNativeCancel);
  }, [onCancel, restoreFocus]);

  function cancel() {
    restoreFocus();
    onCancel();
  }

  function confirm() {
    if (!confirmable) return;
    restoreFocus();
    onConfirm();
  }

  return (
    <dialog
      ref={ref}
      class={["pk-dialog", destructive ? "pk-dialog--destructive" : null].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div class="pk-dialog__head">
        <h2 class="pk-dialog__title" id={titleId}>
          {title}
        </h2>
      </div>

      <div class="pk-dialog__body">
        {description && (
          <p class="pk-dialog__description" id={descriptionId}>
            {description}
          </p>
        )}

        {consequences && consequences.length > 0 && (
          <ul class="pk-dialog__consequences">
            {consequences.map((consequence) => (
              <li key={consequence}>{consequence}</li>
            ))}
          </ul>
        )}

        {children}

        {confirmPhrase && (
          <div class="pk-dialog__confirm">
            <label class="pk-dialog__confirm-label" for={`${id}-phrase`}>
              {confirmPrompt ?? `Type ${confirmPhrase} to confirm`}
            </label>
            <input
              id={`${id}-phrase`}
              class="pk-input"
              type="text"
              value={typed}
              autocomplete="off"
              spellcheck={false}
              onInput={(event) => setTyped((event.target as HTMLInputElement).value)}
            />
          </div>
        )}
      </div>

      <div class="pk-dialog__foot">
        <Button variant="ghost" onClick={cancel}>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? "danger" : "primary"} disabled={!confirmable} onClick={confirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
