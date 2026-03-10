import type { FormField } from "./types";
import { createHelpText, isFieldVisible, readRules } from "./custom-field-rules";
import { createFieldInput } from "./custom-field-widgets";

type FieldValue = string | number | boolean | string[] | { start: string; end: string };

export function renderCustomFields(container: HTMLElement, fields: FormField[]): void {
  container.innerHTML = "";
  if (fields.length === 0) {
    container.innerHTML = "<p>No additional questions.</p>";
    return;
  }

  for (const field of fields.sort((a, b) => a.sortOrder - b.sortOrder)) {
    const rules = readRules(field);
    const row = document.createElement("div");
    row.className = field.fieldType === "boolean" ? "form-check mb-3" : "mb-3";
    row.dataset.customFieldKey = field.key;
    row.dataset.customFieldRules = JSON.stringify(rules);

    const label = document.createElement("label");
    label.textContent = field.label;
    label.className = field.fieldType === "boolean" ? "form-check-label" : "form-label";

    const input = createFieldInput(field);

    if (field.fieldType === "boolean") {
      input.id = `custom-${field.key}`;
      (label as HTMLLabelElement).htmlFor = input.id;
      row.append(input, label);
    } else {
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) {
        input.id = `custom-${field.key}`;
        (label as HTMLLabelElement).htmlFor = input.id;
      }
      row.append(label, input);
    }

    const help = createHelpText(rules);
    if (help) {
      row.append(help);
    }

    const error = document.createElement("div");
    error.className = "invalid-feedback d-block";
    error.dataset.fieldError = field.key;
    row.append(error);

    container.append(row);
  }
}

function clearRowValues(row: HTMLElement): void {
  const fields = row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name^='custom.']");
  for (const field of Array.from(fields)) {
    if (field instanceof HTMLInputElement) {
      if (field.type === "checkbox" || field.type === "radio") {
        field.checked = false;
      } else {
        field.value = "";
      }
    } else if (field instanceof HTMLSelectElement) {
      if (field.multiple) {
        for (const option of Array.from(field.options)) {
          option.selected = false;
        }
      } else {
        field.value = "";
      }
    } else {
      field.value = "";
    }
  }

  const errors = row.querySelectorAll<HTMLElement>("[data-field-error]");
  for (const error of Array.from(errors)) {
    error.textContent = "";
  }
}

function setRowEnabled(row: HTMLElement, enabled: boolean): void {
  const fields = row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name^='custom.']");
  for (const field of Array.from(fields)) {
    field.disabled = !enabled;
  }
}

export function applyCustomFieldVisibility(
  container: HTMLElement,
  context: {
    dayAttendance: Array<{ attendanceType: string }>;
    eventAttendanceType?: "in_person" | "virtual" | "on_demand";
  },
): void {
  const rows = container.querySelectorAll<HTMLElement>("[data-custom-field-key]");
  for (const row of Array.from(rows)) {
    const rulesRaw = row.dataset.customFieldRules;
    let rules: Parameters<typeof isFieldVisible>[0] = {};
    if (rulesRaw) {
      try {
        rules = JSON.parse(rulesRaw) as Parameters<typeof isFieldVisible>[0];
      } catch {
        rules = {};
      }
    }
    const visible = isFieldVisible(rules, context);

    row.classList.toggle("visually-hidden", !visible);
    row.setAttribute("aria-hidden", visible ? "false" : "true");
    setRowEnabled(row, visible);

    if (!visible) {
      clearRowValues(row);
    }
  }
}

export function readCustomFieldValues(form: HTMLFormElement): Record<string, FieldValue> {
  const payload: Record<string, FieldValue> = {};
  const handled = new Set<string>();

  const tagInputs = form.querySelectorAll<HTMLInputElement>("input[name^='custom.'][data-custom-widget='tags']");
  for (const input of Array.from(tagInputs)) {
    const key = input.name.replace(/^custom\./, "");
    try {
      const values = JSON.parse(input.value) as unknown;
      if (Array.isArray(values) && values.length > 0) {
        payload[key] = values.map((entry) => String(entry));
      }
    } catch {
      continue;
    }
    handled.add(key);
  }

  const ratingInputs = form.querySelectorAll<HTMLInputElement>("input[name^='custom.'][data-custom-widget='rating']");
  for (const input of Array.from(ratingInputs)) {
    const key = input.name.replace(/^custom\./, "");
    const value = input.value.trim();
    if (value.length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        payload[key] = parsed;
      }
    }
    handled.add(key);
  }

  const startInputs = form.querySelectorAll<HTMLInputElement>("input[name^='custom.'][name$='.start']");
  for (const startInput of Array.from(startInputs)) {
    const key = startInput.name.replace(/^custom\./, "").replace(/\.start$/, "");
    const endInput = form.querySelector<HTMLInputElement>(`input[name='custom.${key}.end']`);
    const start = startInput.value.trim();
    const end = endInput?.value.trim() ?? "";
    if (start && end) {
      payload[key] = { start, end };
    }
    handled.add(key);
  }

  const checkboxGroups = form.querySelectorAll<HTMLInputElement>("input[type='checkbox'][name^='custom.'][name$='[]']");
  const grouped = new Map<string, string[]>();
  for (const checkbox of Array.from(checkboxGroups)) {
    if (!checkbox.checked) {
      continue;
    }
    const key = checkbox.name.replace(/^custom\./, "").replace(/\[\]$/, "");
    const values = grouped.get(key) ?? [];
    values.push(checkbox.value);
    grouped.set(key, values);
  }

  for (const [key, values] of grouped.entries()) {
    payload[key] = values;
    handled.add(key);
  }

  const checkboxes = form.querySelectorAll<HTMLInputElement>("input[type='checkbox'][name^='custom.']:not([name$='[]'])");
  for (const checkbox of Array.from(checkboxes)) {
    const key = checkbox.name.replace(/^custom\./, "");
    payload[key] = checkbox.checked;
    handled.add(key);
  }

  const fields = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name^='custom.']");
  for (const field of Array.from(fields)) {
    const key = field.name.replace(/^custom\./, "");
    if (key.endsWith(".start") || key.endsWith(".end")) {
      continue;
    }
    // Checkbox-group members use name="custom.foo[]" and are fully handled
    // by the grouped-checkbox block above. Skip them here to avoid sending
    // "foo[]" as a key to the backend.
    if (key.endsWith("[]")) {
      continue;
    }
    if (handled.has(key)) {
      continue;
    }

    if (field instanceof HTMLSelectElement && field.multiple) {
      const values = Array.from(field.selectedOptions).map((option) => option.value);
      if (values.length > 0) {
        payload[key] = values;
      }
      continue;
    }

    const value = field.value.trim();
    if (value.length === 0) {
      continue;
    }

    if (field instanceof HTMLInputElement && (field.type === "number" || field.type === "hidden")) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        payload[key] = parsed;
        continue;
      }
    }

    payload[key] = value;
  }

  return payload;
}
