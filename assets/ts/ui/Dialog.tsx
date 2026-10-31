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
import { nextDomId } from "./dom-id";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { Button } from "./Button";
import { CloseButton, type CloseLabel } from "./CloseButton";
import { HeadingOutline } from "./HeadingOutline";

import "./Dialog.css";

export interface DialogProps {
  open: boolean;
  title: string;
  /** A short line naming where the subject sits, set above the title. */
  kicker?: ComponentChildren;
  /** One line of facts about the subject, set below the title. */
  meta?: ComponentChildren;
  /** Adds the shared close control to the header, named for what it closes. It cancels. */
  closeLabel?: CloseLabel;
  /** A modifier class for a dialog whose header carries its subject's own look. */
  class?: string;
  /** Explains what will happen. One sentence. */
  description?: string;
  /** The specific, irreversible effects. Rendered as a list. */
  consequences?: readonly string[];
  /** Requires the operator to type this before confirming. Compared trimmed. */
  confirmPhrase?: string;
  /** Label above the confirmation input. Ignored without `confirmPhrase`. */
  confirmPrompt?: string;
  confirmLabel: string;
  /**
   * The backing-out action's label; null drops it where the confirm already
   * closes and there is nothing to discard, such as a view with one Close.
   */
  cancelLabel?: string | null;
  /**
   * Holds the confirm button closed for a reason the dialog's own content
   * carries — a scoped decision with nothing left in scope, say. The typed
   * phrase gate below is the other reason, and both have to be satisfied.
   */
  confirmDisabled?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * A viewer — an enlarged picture, a monitor — has nothing to confirm. It
   * drops the footer and closes through its header control and Escape,
   * so it needs `closeLabel`.
   */
  viewer?: boolean;
  /**
   * `wide` is an editor for a list of things — a sequence of messages, a set
   * of polls — with room for a list beside its detail. It keeps one height
   * whatever its content, so switching items or tabs never moves its header
   * and actions; its body scrolls inside.
   */
  size?: "default" | "wide";
  children?: ComponentChildren;
}

/** Closes the native modal, with the same fallback as opening it for environments without `close`. */
function closeDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

export function Dialog({
  open,
  title,
  kicker,
  meta,
  closeLabel,
  class: className,
  description,
  consequences,
  confirmPhrase,
  confirmPrompt,
  confirmLabel,
  cancelLabel = "Cancel",
  confirmDisabled = false,
  destructive = false,
  onConfirm,
  onCancel,
  viewer = false,
  size = "default",
  children,
}: DialogProps) {
  // Dialog portals share the document across independently rendered portal and site roots.
  const [id] = useState(() => nextDomId("dialog"));
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const ref = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<Element | null>(null);
  const [typed, setTyped] = useState("");

  // Trimmed, because the phrase is usually pasted — an organization's name, an
  // email address — and a trailing space is not a sign that the operator meant
  // something else.
  const confirmable = !confirmDisabled && (!confirmPhrase || typed.trim() === confirmPhrase);

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
      // Close first: while the modal is open the rest of the page is inert,
      // and the browser refuses to move focus to the opener inside it.
      closeDialog(dialog);
      restoreFocus();
    }
  }, [open, restoreFocus]);

  // A caller may unmount the dialog instead of closing it. Close it on the way
  // out for the same reason, so focus still returns to what opened it.
  useEffect(
    () => () => {
      const dialog = ref.current;
      if (dialog?.open) closeDialog(dialog);
      restoreFocus();
    },
    [restoreFocus],
  );

  // The platform fires `cancel` for Escape and the close request. Routing it
  // through onCancel gives callers a single "the operator backed out" path.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const onNativeCancel = (event: Event) => {
      event.preventDefault();
      onCancel();
    };
    dialog.addEventListener("cancel", onNativeCancel);
    return () => dialog.removeEventListener("cancel", onNativeCancel);
  }, [onCancel]);

  // Focus returns when the dialog actually closes, not here: a confirm that
  // saves first keeps the dialog open, and the page behind it is still inert.
  function cancel() {
    onCancel();
  }

  function confirm() {
    if (!confirmable) return;
    onConfirm();
  }

  return (
    <dialog
      ref={ref}
      class={[
        "pk-dialog",
        destructive ? "pk-dialog--destructive" : null,
        size === "wide" ? "pk-dialog--wide" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      /*
       * A destructive dialog is an alertdialog: it interrupts to report a
       * consequence, and screen readers announce its description immediately
       * rather than waiting for focus to reach it. A neutral confirmation is
       * an ordinary dialog and should not claim the alert treatment.
       */
      role={destructive ? "alertdialog" : undefined}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
    >
      <div class="pk-dialog__head">
        <div class="pk-dialog__heading">
          {kicker && <p class="pk-dialog__kicker">{kicker}</p>}
          <h2 class="pk-dialog__title" id={titleId}>
            {title}
          </h2>
          {meta && <p class="pk-dialog__meta">{meta}</p>}
        </div>
        {closeLabel && <CloseButton label={closeLabel} onClick={cancel} />}
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

        <HeadingOutline titleLevel={2}>{children}</HeadingOutline>

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

      {viewer ? null : (
        <div class="pk-dialog__foot">
          {cancelLabel === null ? null : (
            <Button variant="ghost" onClick={cancel}>
              {cancelLabel}
            </Button>
          )}
          <Button variant={destructive ? "danger" : "primary"} disabled={!confirmable} onClick={confirm}>
            {confirmLabel}
          </Button>
        </div>
      )}
    </dialog>
  );
}
