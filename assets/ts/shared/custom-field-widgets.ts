import type { FormField } from "./types";
import { applyCommonAttributes, optionsFor, type FieldRules, readRules } from "./custom-field-rules";
import { COUNTRIES } from "./countries";

function createBooleanInput(field: FormField): HTMLElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = `custom.${field.key}`;
  input.className = "form-check-input";
  return input;
}

function createSelectInput(field: FormField, rules: FieldRules): HTMLElement {
  const select = document.createElement("select");
  select.name = `custom.${field.key}`;
  select.className = "form-select";

  const firstLabel = rules.placeholder && rules.placeholder.trim().length > 0 ? rules.placeholder : "Please select";
  select.append(new Option(firstLabel, ""));
  for (const option of optionsFor(field)) {
    select.append(new Option(option.label, option.value));
  }

  applyCommonAttributes(select, field, rules);
  return select;
}

function createMultiSelectCheckboxes(field: FormField): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "event-flow-checkbox-group";

  const options = optionsFor(field);
  for (const [index, option] of options.entries()) {
    const row = document.createElement("div");
    row.className = "form-check mb-2";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "form-check-input";
    input.name = `custom.${field.key}[]`;
    input.value = option.value;
    input.id = `custom-${field.key}-${index}`;

    const label = document.createElement("label");
    label.className = "form-check-label";
    label.htmlFor = input.id;
    label.textContent = option.label;

    row.append(input, label);
    wrapper.append(row);
  }

  return wrapper;
}

/** Fisher-Yates shuffle — returns a new shuffled copy of the array. */
function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Tag picker with quick-add suggestion chips.
 *
 * When a field has pre-defined options, they are shown as clickable pill chips
 * in a *random* order beneath the freetext input — no bias, fast to pick.
 * Selected tags are shown as dismissible pills. The user can still type a
 * custom value when `allowCustom` is true.
 */
function createTagPicker(field: FormField, rules: FieldRules): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "event-flow-tags";

  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = `custom.${field.key}`;
  hidden.dataset.customWidget = "tags";
  hidden.value = "[]";

  const options = optionsFor(field);

  // ── Selected pills row ──────────────────────────────────────────────────
  const selected = document.createElement("div");
  selected.className = "event-flow-tags-selected";

  const selectedValues = new Set<string>();

  const updateSuggestionVisibility = () => {
    const chips = suggestionsRow.querySelectorAll<HTMLButtonElement>("[data-tag-chip]");
    chips.forEach((chip) => {
      const hidden = selectedValues.has(chip.dataset.value ?? "");
      chip.classList.toggle("is-selected", hidden);
      chip.setAttribute("aria-pressed", hidden ? "true" : "false");
    });
  };

  const sync = () => {
    hidden.value = JSON.stringify(Array.from(selectedValues));
    selected.innerHTML = "";

    for (const value of selectedValues) {
      const pill = document.createElement("span");
      pill.className = "event-flow-tag-pill";

      const name = document.createElement("span");
      name.textContent = value;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "event-flow-tag-remove";
      remove.setAttribute("aria-label", `Remove ${value}`);
      remove.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg>`;
      remove.addEventListener("click", () => {
        selectedValues.delete(value);
        sync();
        updateSuggestionVisibility();
        text.focus();
      });

      pill.append(name, remove);
      selected.append(pill);
    }
  };

  const addValue = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (rules.allowCustom !== true && options.length > 0 && !options.some((o) => o.value === trimmed)) {
      text.setCustomValidity("Please select a value from the suggested list.");
      text.reportValidity();
      return;
    }

    if (rules.maxItems !== undefined && selectedValues.size >= rules.maxItems) {
      text.setCustomValidity(`You can add at most ${rules.maxItems} topics.`);
      text.reportValidity();
      return;
    }

    text.setCustomValidity("");
    selectedValues.add(trimmed);
    text.value = "";
    sync();
    updateSuggestionVisibility();
  };

  // ── Text input + Add button ─────────────────────────────────────────────
  const controls = document.createElement("div");
  controls.className = "event-flow-tags-controls";

  const text = document.createElement("input");
  text.type = "text";
  text.className = "form-control";
  text.placeholder = rules.placeholder ?? "Type a topic and press Enter";
  text.autocomplete = "off";

  // Datalist for native browser autocomplete when typing.
  if (options.length > 0) {
    const datalistId = `custom-${field.key}-options`;
    const datalist = document.createElement("datalist");
    datalist.id = datalistId;
    for (const option of options) {
      const entry = document.createElement("option");
      entry.value = option.value;
      datalist.append(entry);
    }
    text.setAttribute("list", datalistId);
    wrapper.append(datalist);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "btn btn-outline-secondary btn-sm";
  addButton.textContent = "Add";
  addButton.addEventListener("click", () => addValue(text.value));
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); addValue(text.value); }
  });
  text.addEventListener("input", () => text.setCustomValidity(""));

  controls.append(text, addButton);

  // ── Suggestion chips (shuffled to avoid perceived bias) ─────────────────
  const suggestionsRow = document.createElement("div");
  suggestionsRow.className = "event-flow-tags-suggestions";

  if (options.length > 0) {
    const shuffledOptions = shuffled(options);
    for (const option of shuffledOptions) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "event-flow-tag-chip";
      chip.dataset.tagChip = "1";
      chip.dataset.value = option.value;
      chip.setAttribute("aria-pressed", "false");
      chip.textContent = option.label;
      chip.addEventListener("click", () => {
        if (selectedValues.has(option.value)) {
          selectedValues.delete(option.value);
          sync();
        } else {
          addValue(option.value);
        }
        updateSuggestionVisibility();
      });
      suggestionsRow.append(chip);
    }
  }

  wrapper.append(hidden, selected, controls, suggestionsRow);

  return wrapper;
}

function createRatingButtons(field: FormField, min: number, max: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "event-flow-rating d-flex flex-wrap gap-2";

  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = `custom.${field.key}`;

  for (let value = min; value <= max; value += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary btn-sm";
    button.textContent = String(value);
    button.dataset.value = String(value);
    button.addEventListener("click", () => {
      hidden.value = String(value);
      const allButtons = wrapper.querySelectorAll<HTMLButtonElement>("button[data-value]");
      allButtons.forEach((entry) => {
        entry.classList.toggle("btn-primary", entry.dataset.value === String(value));
        entry.classList.toggle("btn-outline-secondary", entry.dataset.value !== String(value));
      });
    });

    wrapper.append(button);
  }

  wrapper.prepend(hidden);
  return wrapper;
}

/**
 * Country select: a native <select> populated from the bundled ISO 3166-1
 * alpha-2 list. Value is the ISO code (e.g. "NL"), visible label is the
 * English country name.
 *
 * A geo hint from /api/v1/geo can pre-select the detected country. The hint
 * is stored on the wrapper element via an exposed method so the registration
 * page can call it after the asynchronous geo fetch resolves.
 */
function createCountrySelect(field: FormField, rules: FieldRules): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "event-flow-country-wrapper";
  wrapper.dataset.countryWidget = "1";

  const select = document.createElement("select");
  select.name = `custom.${field.key}`;
  select.className = "form-select";
  select.id = `custom-${field.key}`;
  select.required = field.required;

  select.append(new Option(rules.placeholder ?? "Select your country", ""));
  for (const country of COUNTRIES) {
    select.append(new Option(country.label, country.value));
  }

  const hint = document.createElement("div");
  hint.className = "event-flow-country-hint form-text";
  hint.hidden = true;
  hint.setAttribute("aria-live", "polite");

  // Expose hook so the registration page can apply the geo hint after load.
  const applyGeoHint = (code: string | null | undefined) => {
    if (!code || select.value) return; // don't override an explicit user choice
    const option = select.querySelector<HTMLOptionElement>(`option[value="${code.toUpperCase()}"]`);
    if (option) {
      select.value = option.value;
      hint.textContent = "Detected from your network — change if needed";
      hint.hidden = false;
    }
  };
  (wrapper as HTMLElement & { applyGeoHint?: (code: string | null) => void }).applyGeoHint = applyGeoHint;

  // Dismiss hint once user interacts with the select.
  select.addEventListener("change", () => { hint.hidden = true; });

  wrapper.append(select, hint);
  return wrapper;
}

function createDateRangeInput(field: FormField): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "row g-2";

  const start = document.createElement("input");
  start.type = "date";
  start.className = "form-control";
  start.name = `custom.${field.key}.start`;
  start.required = field.required;

  const end = document.createElement("input");
  end.type = "date";
  end.className = "form-control";
  end.name = `custom.${field.key}.end`;
  end.required = field.required;

  const startCol = document.createElement("div");
  startCol.className = "col-md-6";
  const endCol = document.createElement("div");
  endCol.className = "col-md-6";

  startCol.append(start);
  endCol.append(end);
  wrapper.append(startCol, endCol);

  return wrapper;
}

function createDefaultInput(field: FormField, rules: FieldRules): HTMLElement {
  if (field.fieldType === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.name = `custom.${field.key}`;
    textarea.rows = 4;
    textarea.className = "form-control";
    applyCommonAttributes(textarea, field, rules);
    return textarea;
  }

  const input = document.createElement("input");
  input.name = `custom.${field.key}`;
  input.className = "form-control";

  if (field.fieldType === "number") {
    input.type = "number";
  } else if (field.fieldType === "date") {
    input.type = "date";
  } else if (field.fieldType === "email") {
    input.type = "email";
  } else if (field.fieldType === "url") {
    input.type = "url";
  } else {
    input.type = rules.format === "phone" ? "tel" : "text";
  }

  applyCommonAttributes(input, field, rules);
  return input;
}

export function createFieldInput(field: FormField): HTMLElement {
  const rules = readRules(field);

  if (field.fieldType === "boolean") {
    return createBooleanInput(field);
  }

  if (field.fieldType === "select") {
    return createSelectInput(field, rules);
  }

  if (field.fieldType === "multi_select") {
    if (rules.uiWidget === "checkboxes") {
      return createMultiSelectCheckboxes(field);
    }
    return createTagPicker(field, rules);
  }

  if (rules.uiWidget === "rating_stars") {
    return createRatingButtons(field, Number.isFinite(rules.min) ? Number(rules.min) : 1, Number.isFinite(rules.max) ? Number(rules.max) : 5);
  }

  if (rules.uiWidget === "nps") {
    return createRatingButtons(field, 0, 10);
  }

  if (rules.format === "date_range") {
    return createDateRangeInput(field);
  }

  if (rules.format === "iso_country") {
    return createCountrySelect(field, rules);
  }

  return createDefaultInput(field, rules);
}
