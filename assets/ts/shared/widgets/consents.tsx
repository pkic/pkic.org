import { render } from "preact";
import { ConsentList } from "../../components/ConsentCard";
import type { RequiredTerm } from "../types";

export function renderConsentInputs(container: HTMLElement, terms: RequiredTerm[]): void {
  // Clear any server-rendered placeholder (e.g. "Loading…") before Preact
  // takes over, as Preact's first diff may not remove pre-existing children.
  container.textContent = "";
  render(<ConsentList terms={terms} />, container);
}

/**
 * Asks each consent control to re-check itself, so a required term that has
 * not been agreed to shows its error before the form is submitted.
 *
 * This used to walk up to the surrounding card and toggle Bootstrap's
 * `is-invalid` on it — a second copy of validation state living in a class
 * list, which only the legacy stylesheet knew how to draw. `checkValidity()`
 * fires the platform's own `invalid` event on a control that fails, and the
 * card listens for it, so the state has one owner again.
 */
export function syncConsentValidation(form: HTMLFormElement): void {
  // A data attribute, not a class. The class this replaced was doing two
  // contradictory jobs at once: a query hook here, and "hide this control
  // behind a drawn card" in the legacy stylesheet. The second job reached the
  // first one's elements and rendered every consent in every event flow
  // invisible and unclickable.
  const checkboxes = form.querySelectorAll<HTMLInputElement>("input[data-consent-input]");
  for (const checkbox of Array.from(checkboxes)) {
    checkbox.checkValidity();
  }
}

export function readConsentValues(form: HTMLFormElement): Array<{ termKey: string; version: string }> {
  const selected = form.querySelectorAll<HTMLInputElement>("input[name='consents']:checked");
  return Array.from(selected).map((input) => {
    const [termKey, version] = input.value.split(":", 2);
    return { termKey, version };
  });
}
