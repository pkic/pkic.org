import type { RequiredTerm } from "./types";

function termLabel(term: RequiredTerm): string {
  if (term.displayText && term.displayText.trim().length > 0) {
    return term.displayText.trim();
  }
  return term.termKey.replace(/[-_]/g, " ");
}

/**
 * Render an interactive consent card for a single term.
 *
 * Standard items (no helpText) are slim single-row cards.
 * Items with helpText ("featured") get a two-zone layout:
 *   - Top zone: context/explanation (what the user is agreeing to)
 *   - Bottom zone: the explicit yes/no checkbox action
 *
 * The entire card is clickable to toggle the checkbox; only the external
 * "Read" link is excluded so it can navigate independently.
 */
function buildConsentCard(term: RequiredTerm): HTMLElement {
  const checkboxId = `consent-${term.termKey}-${term.version}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const label = termLabel(term);
  const hasNote = Boolean(term.helpText?.trim());

  // Hidden native checkbox — the card appearance drives the visual state
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "consents";
  checkbox.value = `${term.termKey}:${term.version}`;
  checkbox.required = term.required;
  checkbox.className = "event-flow-consent-native-check visually-hidden";
  checkbox.id = checkboxId;

  // Keep card class in sync with checked state
  const syncCard = (card: HTMLElement) => {
    card.classList.toggle("is-checked", checkbox.checked);
    card.setAttribute("aria-checked", String(checkbox.checked));
  };

  // ── Featured card (has explanatory context) ──────────────────────────────
  if (hasNote) {
    const card = document.createElement("div");
    card.className = "event-flow-consent-card event-flow-consent-card--featured";
    card.setAttribute("role", "checkbox");
    card.setAttribute("aria-checked", "false");
    card.setAttribute("tabindex", "0");

    // Top zone: context / why this matters
    const topZone = document.createElement("div");
    topZone.className = "event-flow-consent-card-context";

    const contextIcon = document.createElement("span");
    contextIcon.className = "event-flow-consent-card-icon";
    contextIcon.setAttribute("aria-hidden", "true");
    // Inline SVG: information-circle outline
    contextIcon.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">` +
      `<path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>` +
      `<path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/>` +
      `</svg>`;

    const contextText = document.createElement("p");
    contextText.className = "event-flow-consent-card-context-text";
    contextText.textContent = term.helpText!.trim();

    topZone.append(contextIcon, contextText);

    // Bottom zone: the explicit agreement action
    const bottomZone = document.createElement("div");
    bottomZone.className = "event-flow-consent-card-action";

    // Visual custom checkbox indicator
    const indicator = document.createElement("span");
    indicator.className = "event-flow-consent-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerHTML =
      `<svg class="event-flow-consent-indicator-check" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">` +
      `<path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/>` +
      `</svg>`;

    const actionLabel = document.createElement("label");
    actionLabel.className = "event-flow-consent-card-label";
    actionLabel.htmlFor = checkboxId;
    actionLabel.textContent = label;

    bottomZone.append(checkbox, indicator, actionLabel);

    if (term.contentRef) {
      const readLink = document.createElement("a");
      readLink.href = term.contentRef;
      readLink.className = "event-flow-consent-read-link";
      readLink.target = "_blank";
      readLink.rel = "noopener noreferrer";
      readLink.setAttribute("aria-label", `Read: ${label}`);
      readLink.innerHTML =
        `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">` +
        `<path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5"/>` +
        `<path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0z"/>` +
        `</svg> Read`;
      bottomZone.append(readLink);
    }

    card.append(topZone, bottomZone);

    checkbox.addEventListener("change", () => syncCard(card));
    // Make the card itself (but not the read-link) toggle the checkbox
    card.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest("a, label")) return; // let label/link handle natively
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    return card;
  }

  // ── Standard card (no explanatory context) ───────────────────────────────
  const card = document.createElement("div");
  card.className = "event-flow-consent-card";
  card.setAttribute("role", "checkbox");
  card.setAttribute("aria-checked", "false");
  card.setAttribute("tabindex", "0");

  const indicator = document.createElement("span");
  indicator.className = "event-flow-consent-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.innerHTML =
    `<svg class="event-flow-consent-indicator-check" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">` +
    `<path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0"/>` +
    `</svg>`;

  const actionLabel = document.createElement("label");
  actionLabel.className = "event-flow-consent-card-label";
  actionLabel.htmlFor = checkboxId;
  actionLabel.textContent = label;

  card.append(checkbox, indicator, actionLabel);

  if (term.contentRef) {
    const readLink = document.createElement("a");
    readLink.href = term.contentRef;
    readLink.className = "event-flow-consent-read-link";
    readLink.target = "_blank";
    readLink.rel = "noopener noreferrer";
    readLink.setAttribute("aria-label", `Read: ${label}`);
    readLink.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">` +
      `<path fill-rule="evenodd" d="M8.636 3.5a.5.5 0 0 0-.5-.5H1.5A1.5 1.5 0 0 0 0 4.5v10A1.5 1.5 0 0 0 1.5 16h10a1.5 1.5 0 0 0 1.5-1.5V7.864a.5.5 0 0 0-1 0V14.5a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5v-10a.5.5 0 0 1 .5-.5h6.636a.5.5 0 0 0 .5-.5"/>` +
      `<path fill-rule="evenodd" d="M16 .5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793L6.146 9.146a.5.5 0 1 0 .708.708L15 1.707V5.5a.5.5 0 0 0 1 0z"/>` +
      `</svg> Read`;
    card.append(readLink);
  }

  checkbox.addEventListener("change", () => syncCard(card));
  card.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("a, label")) return;
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  });
  card.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  return card;
}

export function renderConsentInputs(container: HTMLElement, terms: RequiredTerm[]): void {
  container.innerHTML = "";
  if (terms.length === 0) {
    container.innerHTML = "<p>No required consents for this flow.</p>";
    return;
  }

  const list = document.createElement("div");
  list.className = "event-flow-consents";

  for (const term of terms) {
    list.append(buildConsentCard(term));
  }

  container.append(list);
}

export function readConsentValues(form: HTMLFormElement): Array<{ termKey: string; version: string }> {
  const selected = form.querySelectorAll<HTMLInputElement>("input[name='consents']:checked");
  return Array.from(selected).map((input) => {
    const [termKey, version] = input.value.split(":", 2);
    return { termKey, version };
  });
}
