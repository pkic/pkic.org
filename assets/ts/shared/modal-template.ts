/**
 * Mounting, opening and dismissing a modal dialog that Hugo rendered into a
 * `<template>`.
 *
 * The roots are native `<dialog>` elements opened with `showModal()`, which is
 * the same choice the design system's `ui/Dialog` makes and for the same
 * reasons: the platform supplies the top layer, focus containment, an inert
 * page behind, a styleable `::backdrop`, and Escape. A hand-rolled overlay
 * `<div role="dialog">` has to re-implement all five, and the one this module
 * replaced re-implemented none of them — worse, it carried a static
 * `aria-hidden="true"` that the show path never cleared, so every control
 * inside was absent from the accessibility tree while plainly on screen.
 *
 * `ui/Dialog` itself cannot serve these callers: it is a Preact component, and
 * these dialogs are markup Hugo renders and vanilla TypeScript drives. So the
 * approach is shared here, not the component.
 */

/**
 * What had focus when each dialog opened.
 *
 * The platform returns focus to the element that called `showModal()`, but
 * only while that element is still in the document — and these flows re-render
 * the surface underneath them, so the opener is captured and restored
 * explicitly. Keyed weakly so a dismissed dialog's entry goes with it.
 */
const openers = new WeakMap<HTMLDialogElement, Element>();

/**
 * Clones `templateId` into the page and returns its `<dialog>` root, or the
 * one already mounted. Returns null after reporting why, so a caller can
 * settle its own promise rather than throw at a reader who only clicked
 * "upload".
 */
export function mountModalTemplate(templateId: string, dialogId: string, errorLabel: string): HTMLDialogElement | null {
  const existing = document.getElementById(dialogId);
  if (existing instanceof HTMLDialogElement) {
    return existing;
  }

  const template = document.getElementById(templateId);
  if (!(template instanceof HTMLTemplateElement)) {
    console.error(`${errorLabel} template not found`);
    return null;
  }

  document.body.appendChild(template.content.cloneNode(true));

  const dialog = document.getElementById(dialogId);
  if (!(dialog instanceof HTMLDialogElement)) {
    // Not merely "no root": a root that is not a dialog would render as an
    // ordinary block in the page flow, with none of the modal behaviour the
    // caller is relying on. Failing here is better than showing that.
    console.error(`${errorLabel} template did not render a dialog`);
    return null;
  }

  return dialog;
}

/** Opens `dialog` modally, remembering what to give focus back to. */
export function openModalDialog(dialog: HTMLDialogElement): void {
  const opener = document.activeElement;
  if (opener) openers.set(dialog, opener);

  // jsdom implements `<dialog>` without `showModal()`, so the fallback keeps
  // the wiring testable rather than leaving the tests to assert against a mock
  // of this module. `ui/Dialog` carries the same fallback for the same reason.
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

/**
 * Closes `dialog`, takes it back out of the page, and returns focus to
 * whatever opened it.
 *
 * These dialogs are mounted per use rather than kept in the page, so dismissal
 * removes the element; closing first releases the top layer explicitly instead
 * of relying on removal to do it.
 */
export function dismissModalDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  dialog.remove();

  const opener = openers.get(dialog);
  openers.delete(dialog);
  // Focus is restored after the removal: moving it first would only hand it
  // straight back to the body when the dialog went.
  if (opener instanceof HTMLElement && document.contains(opener)) {
    opener.focus({ preventScroll: true });
  }
}
