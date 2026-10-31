import { render } from "preact";
import { geolocationCountryResponseSchema } from "../../../shared/schemas/geolocation";
import { getJson } from "../api-client";
import { useData } from "../../hooks/useData";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { FormField } from "../types";
import type { AttendanceType } from "../../../shared/schemas/registration";
import { isFieldVisible, readRules, type FieldRules } from "../form/custom-field-rules";
import { CustomFieldInput } from "../form/custom-field-widgets";
import { setFieldMessage } from "../form/validation-map";
import { applyFieldState } from "../../ui/field-state";
import type { FieldPresentation } from "../../hooks/useContractForm";
// `pk-field__label` and `pk-field__message` are written here as class names
// rather than reached through `Field` — the control itself is rendered by
// `CustomFieldInput`, which owns its own markup — so this module has to pull
// their stylesheet into its own chunk.
import "../../ui/Field.css";
import { ExternalLink } from "../../ui/ExternalLink";

type FieldValue = string | number | boolean | string[] | { start: string; end: string };

export interface VisibilityContext {
  dayAttendance: Array<{ attendanceType: string }>;
  eventAttendanceType?: AttendanceType;
}

// ── Preact components ─────────────────────────────────────────────────────

function HelpText({ id, text }: { id: string; text: string }) {
  return (
    <p class="pk-small" id={id}>
      {text}
    </p>
  );
}

function CustomFieldRow({
  field,
  rules,
  visible,
  geoHint,
  initialValue,
  presentation,
}: {
  field: FormField;
  rules: FieldRules;
  visible: boolean;
  geoHint?: string | null;
  initialValue?: unknown;
  presentation?: FieldPresentation;
}) {
  const isBoolean = field.fieldType === "boolean";
  // The row is a `pk-field`: it holds a label, a control, help text and the
  // slot the validators write into, and `setFieldMessage` reaches the group
  // through `closest(".pk-field")` — outside one, a failed answer had nowhere
  // to put its state. It carries no bottom margin: both callers stack this
  // list, so the gap is theirs to decide once.
  const className = ["pk-field", !visible ? "pk-sr-only" : ""].filter(Boolean).join(" ");

  const helpId = `custom-${field.key}-help`;
  const linkId = `custom-${field.key}-link`;
  const errorId = `custom-${field.key}-error`;
  const hasHelp = Boolean(rules.helpText?.trim());
  // The error slot is always described: a validator writes into it after the
  // fact, and a describedby added only once it has text would be added too
  // late for the control that already has focus.
  const describedBy = [hasHelp ? helpId : null, rules.referenceLink ? linkId : null, errorId].filter(Boolean).join(" ");

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
      // The help sentence, the reference link and the error slot sat beside
      // the control with nothing tying them to it, so none of the three was
      // announced. `CustomFieldInput` renders the control, so the wiring has
      // to happen here rather than as a prop.
      el.setAttribute("aria-describedby", describedBy);
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
  }, [visible, describedBy]);

  useLayoutEffect(() => {
    if (visible && rowRef.current) writeValuesToDOM(rowRef.current, { [field.key]: initialValue });
  }, [field.key, initialValue, visible]);

  // A form on the answer contract says each question's state here, in the
  // same slot and through the same field-state module the DOM validators use.
  const state = presentation?.state ?? null;
  const message = presentation?.message ?? "";
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || !presentation) return;
    const slot = row.querySelector<HTMLElement>("[data-field-error]");
    setFieldMessage(slot, message, state ?? "invalid");
    if (!message) applyFieldState(row, state);
    for (const control of Array.from(row.querySelectorAll("[name^='custom.']"))) {
      if (state === "invalid") control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
    }
  }, [presentation !== undefined, state, message]);

  const widget = <CustomFieldInput field={field} geoHint={geoHint} initialValue={initialValue} />;
  const controlId = `custom-${field.key}`;

  return (
    <div
      ref={rowRef}
      class={className}
      data-custom-field-key={field.key}
      data-custom-field-rules={JSON.stringify(rules)}
      aria-hidden={!visible ? "true" : "false"}
    >
      {/* The label is written out in each arrangement rather than held in a
          variable: a part lifted out of its field is exactly the detachment
          this markup is being kept from, and only the nesting shows that the
          two belong together. */}
      {isBoolean ? (
        // A boolean is a control and its word on one line, so the two share a
        // row inside the field rather than stacking.
        <div class="pk-cluster">
          {widget}
          <label class="pk-field__label" for={controlId}>
            {field.label}
          </label>
        </div>
      ) : (
        <>
          <label class="pk-field__label" for={controlId}>
            {field.label}
          </label>
          {/*
           * No `pk-field__control` around the widget: `CustomFieldInput` picks
           * the control from the field's type, and several of those are a
           * group rather than one box — a checkbox set, a tag picker, a date
           * range. The control box is a flex parent sized to its contents, so
           * putting a group inside one would shrink it to its widest option.
           * The border and the message still take their color from the
           * field's state; only the in-control mark has nowhere to sit, and a
           * group has no single control to mark anyway.
           */}
          {widget}
        </>
      )}
      {hasHelp && <HelpText id={helpId} text={rules.helpText ?? ""} />}
      {rules.referenceLink && (
        <p class="pk-small" id={linkId}>
          <ExternalLink href={rules.referenceLink.href} external>
            {rules.referenceLink.label}
          </ExternalLink>
        </p>
      )}
      {/* The validators write into this slot after render, so it is a live
          region: a message that appears silently is a message nobody who is
          not looking at it will ever get. */}
      <div class="pk-field__message" id={errorId} data-field-error={field.key} aria-live="polite" />
    </div>
  );
}

export function CustomFieldList({
  fields,
  context,
  geoHint,
  initialValues,
  presentationOf,
}: {
  fields: FormField[];
  context: VisibilityContext;
  geoHint?: string | null;
  initialValues?: Record<string, unknown>;
  /** Each question's state from the answer contract, for a form validated through it. */
  presentationOf?: (key: string) => FieldPresentation;
}) {
  const needsCountryHint = geoHint === undefined && fields.some((field) => readRules(field).format === "iso_country");
  const { data: location } = useData(
    () =>
      needsCountryHint
        ? getJson("/api/v1/geolocation/country", geolocationCountryResponseSchema)
        : Promise.resolve(null),
    [needsCountryHint],
  );
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
            geoHint={geoHint ?? location?.country}
            initialValue={initialValues?.[field.key]}
            presentation={presentationOf?.(field.key)}
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
  // Dispose the previous Preact tree before replacing the form definition.
  // Clearing its DOM alone leaves mounted nodes in Preact's reconciliation
  // state, so unchanged questions disappear when the category changes.
  render(null, container);
  // Clear any server-rendered placeholder (e.g. "Loading…") before Preact
  // takes over. CustomFieldList returns a Fragment, so Preact's first diff
  // may not remove pre-existing children reliably.
  container.textContent = "";

  let ctx: VisibilityContext = { dayAttendance: [] };
  let geoHint: string | null | undefined;
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

    // One choice from a visible list
    const radios = container.querySelectorAll<HTMLInputElement>(`input[type='radio'][name='custom.${key}']`);
    if (radios.length > 0) {
      for (const radio of Array.from(radios)) radio.checked = radio.value === String(value);
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
    // Of a radio list only the chosen one answers.
    if (field instanceof HTMLInputElement && field.type === "radio" && !field.checked) continue;

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
