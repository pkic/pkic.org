import { render } from "preact";
import { ConsentList } from "../../components/ConsentCard";
import type { RequiredTerm } from "../types";

export function renderConsentInputs(container: HTMLElement, terms: RequiredTerm[]): void {
  // Clear any server-rendered placeholder (e.g. "Loading…") before Preact
  // takes over, as Preact's first diff may not remove pre-existing children.
  container.textContent = "";
  render(<ConsentList terms={terms} />, container);
}

export function syncConsentValidation(form: HTMLFormElement): void {
  const checkboxes = form.querySelectorAll<HTMLInputElement>("input.event-flow-consent-native-check");
  for (const cb of Array.from(checkboxes)) {
    const card = cb.closest<HTMLElement>(".event-flow-consent-card");
    if (!card) continue;
    card.classList.toggle("is-invalid", cb.required && !cb.checked);
  }
}

export function readConsentValues(form: HTMLFormElement): Array<{ termKey: string; version: string }> {
  const selected = form.querySelectorAll<HTMLInputElement>("input[name='consents']:checked");
  return Array.from(selected).map((input) => {
    const [termKey, version] = input.value.split(":", 2);
    return { termKey, version };
  });
}
