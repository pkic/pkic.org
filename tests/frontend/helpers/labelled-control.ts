/**
 * Reaching into a design-system form from a test.
 *
 * `Field` generates the control's id with `useId`, so a test cannot select on
 * one — and should not want to. What the surface promises a reader is the
 * `for`/`id` pair and the `<legend>` naming a group; resolving a control
 * through those means the lookup fails exactly when the accessibility
 * contract is broken, which is the thing worth asserting.
 */

import { act } from "preact/test-utils";

/** Strips the required marker `Field` appends inside the label element. */
function labelText(label: HTMLLabelElement): string {
  return (label.textContent ?? "").replace(/\*?\(required\)$/, "").trim();
}

/**
 * The control a label names, resolved the way the platform resolves it: through
 * the `for`/`id` pair when the label carries a `for`, and otherwise through the
 * control the label wraps, which is how `Checkbox` and `Radio` bind theirs.
 *
 * The element type is the caller's to name — `controlFor<HTMLSelectElement>(…)`
 * for a select, `<HTMLTextAreaElement>` for a textarea. It defaults to an
 * input because that is what most fields are, and because a caller that reads
 * `.value` should not have to cast to do it.
 */
export function controlFor<Control extends HTMLElement = HTMLInputElement>(root: ParentNode, label: string): Control {
  const match = [...root.querySelectorAll("label")].find((candidate) => labelText(candidate) === label);
  if (!match) throw new Error(`no label reads "${label}"`);
  const control = match.htmlFor
    ? root.querySelector<Control>(`[id="${match.htmlFor}"]`)
    : (match.control as Control | null);
  if (!control) throw new Error(`label "${label}" points at no control`);
  return control;
}

/** Every label in `root`, in document order — the form's announced names. */
export function labelNames(root: ParentNode): string[] {
  return [...root.querySelectorAll("label")].map(labelText);
}

/** A `<fieldset>`, located by the `<legend>` that names it. */
export function namedGroup(root: ParentNode, legend: string): HTMLFieldSetElement {
  const match = [...root.querySelectorAll("fieldset")].find(
    (candidate) => candidate.querySelector("legend")?.textContent === legend,
  );
  if (!match) throw new Error(`no fieldset is named "${legend}"`);
  return match;
}

/** Every `<legend>` in `root`, in document order. */
export function groupNames(root: ParentNode): string[] {
  return [...root.querySelectorAll("legend")].map((legend) => legend.textContent ?? "");
}

/** Types into a control the way the browser would: set, then notify. */
export async function typeInto(control: HTMLElement, value: string): Promise<void> {
  (control as HTMLInputElement).value = value;
  await act(() => {
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Chooses an option the way the browser would. */
export async function chooseOption(control: HTMLElement, value: string): Promise<void> {
  (control as HTMLSelectElement).value = value;
  await act(() => {
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** Submits the one form inside `root` and lets its handler settle. */
export async function submitForm(root: ParentNode): Promise<void> {
  await act(async () => {
    root.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The button whose visible text is exactly `label`. */
export function buttonNamed(root: ParentNode, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!match) throw new Error(`no button reads "${label}"`);
  return match;
}

/** Every button's visible text, in document order. */
export function buttonNames(root: ParentNode): string[] {
  return [...root.querySelectorAll("button")].map((button) => button.textContent ?? "");
}

/**
 * Opens the design-system combobox named by `label` and returns its options.
 *
 * The listbox is resolved through the `aria-controls` wiring the combobox
 * announces, so this fails exactly when the ARIA contract is broken.
 */
export async function openCombobox(root: ParentNode, label: string): Promise<HTMLElement[]> {
  const input = controlFor(root, label);
  if (input.getAttribute("aria-expanded") !== "true") {
    // No timer here: `act` flushes the render, and a timer would never fire
    // for a caller running under fake timers.
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
  }
  const listboxId = input.getAttribute("aria-controls");
  const listbox = listboxId ? (root.querySelector(`[id="${listboxId}"]`) ?? document.getElementById(listboxId)) : null;
  if (!listbox) throw new Error(`combobox "${label}" controls no listbox`);
  return [...listbox.querySelectorAll<HTMLElement>('[role="option"]')];
}

/** Picks the combobox option carrying `key` the way a pointer user would. */
export async function chooseComboboxOption(root: ParentNode, label: string, key: string): Promise<void> {
  const options = await openCombobox(root, label);
  const match = options.find((option) => option.getAttribute("data-key") === key);
  if (!match) throw new Error(`combobox "${label}" lists no option with key "${key}"`);
  await act(async () => {
    match.click();
    await Promise.resolve();
  });
}
