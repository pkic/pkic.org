import { render } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { FormField } from "../types";
import { isFieldVisible, readRules, type FieldRules } from "../form/custom-field-rules";
import { CustomFieldInput } from "../form/custom-field-widgets";

type FieldValue = string | number | boolean | string[] | { start: string; end: string };

interface VisibilityContext {
  dayAttendance: Array<{ attendanceType: string }>;
  eventAttendanceType?: "in_person" | "virtual" | "on_demand";
}

// ── Preact components ─────────────────────────────────────────────────────

function HelpText({ text }: { text: string }) {
  return <div class="form-text">{text}</div>;
}

function CustomFieldRow({
  field,
  rules,
  visible,
  geoHint,
  initialValue,
}: {
  field: FormField;
  rules: FieldRules;
  visible: boolean;
  geoHint?: string | null;
  initialValue?: unknown;
}) {
  const isBoolean = field.fieldType === "boolean";
  const className = [isBoolean ? "form-check mb-3" : "mb-3", !visible ? "visually-hidden" : ""]
    .filter(Boolean)
    .join(" ");

  const rowRef = useRef<HTMLDivElement>(null);

  // Toggle disabled on all form elements and clear values when hidden.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const fields = row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "[name^='custom.']",
    );
    for (const el of Array.from(fields)) {
      el.disabled = !visible;
    }
    if (!visible) {
      for (const el of Array.from(fields)) {
        if (el instanceof HTMLInputElement) {
          if (el.type === "checkbox" || el.type === "radio") el.checked = false;
          else el.value = "";
        } else if (el instanceof HTMLSelectElement) {
          for (const opt of Array.from(el.options)) opt.selected = false;
          el.value = "";
        } else {
          el.value = "";
        }
      }
      const errors = row.querySelectorAll<HTMLElement>("[data-field-error]");
      for (const err of Array.from(errors)) err.textContent = "";
    }
  }, [visible]);

  const widget = <CustomFieldInput field={field} geoHint={geoHint} initialValue={initialValue} />;

  const label = (
    <label class={isBoolean ? "form-check-label" : "form-label"} for={`custom-${field.key}`}>
      {field.label}
    </label>
  );

  return (
    <div
      ref={rowRef}
      class={className}
      data-custom-field-key={field.key}
      data-custom-field-rules={JSON.stringify(rules)}
      aria-hidden={!visible ? "true" : "false"}
    >
      {isBoolean ? (
        <>
          {widget}
          {label}
        </>
      ) : (
        <>
          {label}
          {widget}
        </>
      )}
      {rules.helpText?.trim() && <HelpText text={rules.helpText} />}
      <div class="invalid-feedback d-block" data-field-error={field.key} />
    </div>
  );
}

function CustomFieldList({
  fields,
  context,
  geoHint,
  initialValues,
}: {
  fields: FormField[];
  context: VisibilityContext;
  geoHint?: string | null;
  initialValues?: Record<string, unknown>;
}) {
  if (fields.length === 0) {
    return <p>No additional questions.</p>;
  }

  const sorted = [...fields].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <>
      {sorted.map((field) => {
        const rules = readRules(field);
        const visible = isFieldVisible(rules, context);
        return (
          <CustomFieldRow
            key={field.key}
            field={field}
            rules={rules}
            visible={visible}
            geoHint={geoHint}
            initialValue={initialValues?.[field.key]}
          />
        );
      })}
    </>
  );
}

// ── Controller API ────────────────────────────────────────────────────────

export interface CustomFieldsController {
  /** Re-evaluate visibility rules after day-attendance or attendance-type changes. */
  updateVisibility(context: VisibilityContext): void;
  /** Apply a geo hint (ISO country code) to any country-select widgets. */
  setGeoHint(code: string | null): void;
  /** Pre-fill field values (used by the manage flow). */
  setValues(answers: Record<string, unknown>): void;
}

/**
 * Render custom event fields into the given container.
 *
 * Returns a controller that lets callers update visibility context, apply geo
 * hints, or pre-fill values — all via Preact re-renders.
 */
export function renderCustomFields(container: HTMLElement, fields: FormField[]): CustomFieldsController {
  // Clear any server-rendered placeholder (e.g. "Loading…") before Preact
  // takes over. CustomFieldList returns a Fragment, so Preact's first diff
  // may not remove pre-existing children reliably.
  container.textContent = "";

  let ctx: VisibilityContext = { dayAttendance: [] };
  let geoHint: string | null = null;
  let initialValues: Record<string, unknown> = {};

  function update() {
    render(
      <CustomFieldList fields={fields} context={ctx} geoHint={geoHint} initialValues={initialValues} />,
      container,
    );
  }

  update();

  return {
    updateVisibility(context: VisibilityContext) {
      ctx = context;
      update();
    },
    setGeoHint(code: string | null) {
      geoHint = code;
      update();
    },
    setValues(answers: Record<string, unknown>) {
      initialValues = answers;
      update();

      // For simple form elements (text, select, checkbox, date), Preact
      // renders them uncontrolled — we set DOM values directly so that
      // readCustomFieldValues picks them up correctly.
      writeValuesToDOM(container, answers);
    },
  };
}

/**
 * Imperatively set DOM form element values for simple (uncontrolled) widgets.
 *
 * Stateful widgets like TagPicker and RatingButtons receive their values via
 * the `initialValue` prop and manage state internally. This function handles
 * the remaining "simple" widgets (text inputs, selects, checkboxes, date
 * ranges) that Preact renders as uncontrolled elements.
 */
function writeValuesToDOM(container: HTMLElement, answers: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(answers)) {
    if (value === undefined || value === null) continue;

    // Checkbox groups (multi_select with checkboxes widget)
    if (Array.isArray(value)) {
      const checkboxes = container.querySelectorAll<HTMLInputElement>(`input[type='checkbox'][name='custom.${key}[]']`);
      if (checkboxes.length > 0) {
        const strValues = value.map(String);
        for (const cb of Array.from(checkboxes)) {
          cb.checked = strValues.includes(cb.value);
        }
      }
      // Tag pickers handle arrays via initialValue prop — skip here.
      continue;
    }

    // Date range
    if (typeof value === "object" && "start" in value && "end" in value) {
      const startEl = container.querySelector<HTMLInputElement>(`input[name='custom.${key}.start']`);
      const endEl = container.querySelector<HTMLInputElement>(`input[name='custom.${key}.end']`);
      if (startEl) startEl.value = String((value as Record<string, unknown>).start ?? "");
      if (endEl) endEl.value = String((value as Record<string, unknown>).end ?? "");
      continue;
    }

    // Boolean checkbox
    if (typeof value === "boolean") {
      const cb = container.querySelector<HTMLInputElement>(`input[type='checkbox'][name='custom.${key}']`);
      if (cb) cb.checked = value;
      continue;
    }

    // Simple inputs, selects, textareas
    const el = container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[name='custom.${key}']`,
    );
    if (el) {
      // Skip tag pickers / rating buttons — they are stateful components
      if (el instanceof HTMLInputElement && el.dataset.customWidget) continue;
      el.value = String(value ?? "");
    }
  }
}

// ── Read values from the DOM (unchanged — works with Preact-rendered elements) ──

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
    if (!checkbox.checked) continue;
    const key = checkbox.name.replace(/^custom\./, "").replace(/\[\]$/, "");
    const values = grouped.get(key) ?? [];
    values.push(checkbox.value);
    grouped.set(key, values);
  }
  for (const [key, values] of grouped.entries()) {
    payload[key] = values;
    handled.add(key);
  }

  const checkboxes = form.querySelectorAll<HTMLInputElement>(
    "input[type='checkbox'][name^='custom.']:not([name$='[]'])",
  );
  for (const checkbox of Array.from(checkboxes)) {
    const key = checkbox.name.replace(/^custom\./, "");
    payload[key] = checkbox.checked;
    handled.add(key);
  }

  const fields = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[name^='custom.']");
  for (const field of Array.from(fields)) {
    const key = field.name.replace(/^custom\./, "");
    if (key.endsWith(".start") || key.endsWith(".end")) continue;
    if (key.endsWith("[]")) continue;
    if (handled.has(key)) continue;

    if (field instanceof HTMLSelectElement && field.multiple) {
      const values = Array.from(field.selectedOptions).map((option) => option.value);
      if (values.length > 0) payload[key] = values;
      continue;
    }

    const value = field.value.trim();
    if (value.length === 0) continue;

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
