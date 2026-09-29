import { act } from "preact/test-utils";

import { typeInto } from "./labelled-control";

/**
 * Driving the form definition editor the way a person does.
 *
 * The editor keeps a question's key and its reporting settings behind a
 * disclosure, and derives the form's own key from its title, so a test that
 * reaches straight for an input by name is testing a layout rather than the
 * surface. These helpers take the same steps an author takes, in one place, so
 * the five flows that author a form do not each restate them.
 */

const TITLE = 'input[aria-label="Form title"]';
const QUESTION = 'input[placeholder="What are you asking?"]';

function required<T extends Element>(root: ParentNode, selector: string, what: string): T {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`no ${what} in the form editor`);
  return found;
}

/** Opens a disclosure by its title, if it is not already open. */
export function openFold(root: ParentNode, title: string): void {
  const summary = [...root.querySelectorAll<HTMLButtonElement>("button.pk-fold__summary")].find((candidate) =>
    (candidate.textContent ?? "").includes(title),
  );
  if (!summary) throw new Error(`no fold reads "${title}"`);
  if (summary.getAttribute("aria-expanded") === "true") return;
  void act(() => summary.click());
}

/** The key control of the question currently open, from behind its fold. */
export function questionKeyInput(root: ParentNode): HTMLInputElement {
  openFold(root, "Key and reporting");
  const label = [...root.querySelectorAll("label")].find((entry) => entry.textContent?.trim() === "Field key");
  const control = label?.htmlFor ? document.getElementById(label.htmlFor) : null;
  if (!(control instanceof HTMLInputElement)) throw new Error("no field key control in the form editor");
  return control;
}

/**
 * Names the form.
 *
 * The key follows the title unless a key is given, which is what the editor
 * does: an author who has typed a title has already said what the key is.
 */
export async function nameForm(root: ParentNode, title: string, key?: string): Promise<void> {
  await typeInto(required<HTMLInputElement>(root, TITLE, "form title"), title);
  if (key === undefined) return;
  const change = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === "Change");
  if (change) void act(() => change.click());
  const control = root.querySelector<HTMLInputElement>('input[aria-label="Form key"]');
  if (!control) throw new Error("no form key control in the form editor");
  await typeInto(control, key);
}

/** Fills the open question: what it asks, and the key its answer carries. */
export async function fillQuestion(root: ParentNode, label: string, key: string): Promise<void> {
  await typeInto(required<HTMLInputElement>(root, QUESTION, "question label"), label);
  await typeInto(questionKeyInput(root), key);
}

/** Adds a question by choosing its answer type, which opens the new card. */
export function addQuestion(root: ParentNode, typeLabel: string): void {
  const chip = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === typeLabel,
  );
  if (!chip) throw new Error(`no palette chip for "${typeLabel}"`);
  void act(() => chip.click());
}

/**
 * Opens the question card that reads as `label`.
 *
 * An existing form opens with every question closed, so editing one means
 * selecting it first — the card is the thing an author clicks.
 */
export function openQuestion(root: ParentNode, label: string): void {
  const card = [...root.querySelectorAll<HTMLButtonElement>("button.pk-formq")].find((candidate) =>
    (candidate.textContent ?? "").includes(label),
  );
  if (!card) throw new Error(`no question card reads "${label}"`);
  void act(() => card.click());
}
