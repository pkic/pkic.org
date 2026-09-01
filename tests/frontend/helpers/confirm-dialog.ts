/**
 * Reaching into the portal's confirmation dialog from a test.
 *
 * These deliberately locate by role and by the label/control relationship
 * rather than by class name or element id. Three suites previously selected
 * `#pkic-confirm-typed` and `.pkic-confirm-consequences`, which meant swapping
 * the dialog's implementation broke five tests that were not testing the
 * implementation. Roles and labels are what the dialog promises; class names
 * are how it happens to be built this week.
 */

/** The open confirmation, or null when none is showing. */
export function openConfirmation(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>('[role="alertdialog"], dialog[open]');
}

/** The consequence lines the dialog is showing, in order. */
export function confirmationConsequences(root: ParentNode = document): string[] {
  const dialog = openConfirmation(root);
  if (!dialog) return [];
  return [...dialog.querySelectorAll("li")].map((item) => item.textContent ?? "");
}

/**
 * The "type this to confirm" input, found through its label rather than an id,
 * because the id is generated.
 */
export function typedConfirmationInput(root: ParentNode = document): HTMLInputElement | null {
  const dialog = openConfirmation(root);
  if (!dialog) return null;
  const label = [...dialog.querySelectorAll("label")].find((candidate) =>
    (candidate.textContent ?? "").includes("to confirm"),
  );
  if (!label) return null;
  // getElementById rather than a `#id` selector: the id comes from useId, and
  // jsdom here has no CSS.escape to make it selector-safe.
  const control = label.htmlFor ? dialog.ownerDocument.getElementById(label.htmlFor) : label.querySelector("input");
  return control instanceof HTMLInputElement ? control : null;
}

/** A button inside the confirmation, by its visible label. */
export function confirmationButton(label: string, root: ParentNode = document): HTMLButtonElement | null {
  const dialog = openConfirmation(root);
  if (!dialog) return null;
  return [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === label) ?? null;
}

/**
 * Escape, in a test.
 *
 * The dialog is a native <dialog>, so Escape reaches it as the platform's
 * `cancel` event rather than as a key handler the component installed. jsdom
 * does not translate the keypress, so a test dispatches the event the browser
 * would. This is the right seam: the promise resolves false whenever the
 * platform reports a close request, however the operator made one.
 */
export function requestClose(root: ParentNode = document): void {
  openConfirmation(root)?.dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
}
