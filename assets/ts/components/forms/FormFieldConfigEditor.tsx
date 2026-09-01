import { useState } from "preact/hooks";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Select, TextInput, Textarea } from "../../ui/TextControl";
import type { FormFieldDefinition, FormFieldOptionSource } from "../../../shared/schemas/forms";
import "../../ui/Content.css";

export type FieldType = FormFieldDefinition["fieldType"];
export type VisualizationConfig = "auto" | "bar" | "pie" | "wordcloud" | "list";

export interface FieldDraft {
  key: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  sortOrder: number;
  optionsText: string;
  /** Server-owned option catalog, preserved when editing the field. */
  optionSource?: FormFieldOptionSource;
  adminVisualization: VisualizationConfig;
  placeholder: string;
  helpText: string;
  uiWidget: string;
  format: string;
  pattern: string;
  patternMessage: string;
  minLength: string;
  maxLength: string;
  min: string;
  max: string;
  step: string;
  minItems: string;
  maxItems: string;
  allowCustom: boolean;
  allowedDomainsText: string;
  advancedValidationText: string;
  /** When true the editor shows raw JSON instead of the visual form. */
  rawMode: boolean;
  /** Full validation JSON used when rawMode is true. */
  rawValidationText: string;
}

// ── constants ─────────────────────────────────────────────────────────────────

const VIZ_OPTIONS: Array<{ value: VisualizationConfig; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "bar", label: "Bar chart" },
  { value: "pie", label: "Pie chart" },
  { value: "wordcloud", label: "Word cloud" },
  { value: "list", label: "Top list" },
];

const UI_WIDGETS = ["", "tags", "checkboxes", "rating_stars", "nps"];
const FIELD_FORMATS = ["", "iso_country", "phone", "professional_profile", "date_range"];

const KNOWN_KEYS = new Set([
  "adminVisualization",
  "visualization",
  "placeholder",
  "helpText",
  "uiWidget",
  "format",
  "pattern",
  "patternMessage",
  "minLength",
  "maxLength",
  "min",
  "max",
  "step",
  "minItems",
  "maxItems",
  "allowCustom",
  "allowedDomains",
]);

// ── capabilities per field type ───────────────────────────────────────────────

interface Caps {
  options: boolean;
  placeholder: boolean;
  lengthLimits: boolean;
  numericRange: boolean;
  step: boolean;
  selectionLimits: boolean;
  allowCustom: boolean;
  pattern: boolean;
  allowedDomains: boolean;
  format: boolean;
}

function caps(ft: FieldType): Caps {
  const isTextLike = ft === "text" || ft === "email" || ft === "url";
  const isLong = ft === "textarea";
  const isChoice = ft === "select" || ft === "multi_select";
  return {
    options: isChoice,
    placeholder: !isChoice && ft !== "boolean",
    lengthLimits: isTextLike || isLong,
    numericRange: ft === "number" || ft === "date",
    step: ft === "number",
    selectionLimits: ft === "multi_select",
    allowCustom: isChoice,
    pattern: ft === "text",
    allowedDomains: ft === "email",
    format: isTextLike || isLong || isChoice,
  };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sv(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function nv(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "number" ? String(v) : "";
}

function strAdd(o: Record<string, unknown>, key: string, v: string) {
  const t = v.trim();
  if (t) o[key] = t;
}

function numAdd(o: Record<string, unknown>, key: string, v: string) {
  const t = v.trim();
  if (!t) return;
  const n = Number(t);
  if (Number.isFinite(n)) o[key] = n;
}

// ── payload builder (exported for use in Forms.tsx) ───────────────────────────

export function buildFieldValidation(field: FieldDraft): Record<string, unknown> | undefined {
  if (field.rawMode) {
    const t = field.rawValidationText.trim();
    if (!t || t === "{}") return undefined;
    const parsed = JSON.parse(t) as unknown;
    if (!isRec(parsed)) throw new Error(`${field.label || field.key}: validation must be a JSON object`);
    return Object.keys(parsed).length ? parsed : undefined;
  }

  const result: Record<string, unknown> = {};

  // Merge extra keys from the advanced overflow textarea
  const adv = field.advancedValidationText.trim();
  if (adv && adv !== "{}") {
    const parsed = JSON.parse(adv) as unknown;
    if (isRec(parsed)) Object.assign(result, parsed);
  }

  const c = caps(field.fieldType);
  if (field.adminVisualization !== "auto") result.adminVisualization = field.adminVisualization;
  if (c.placeholder) strAdd(result, "placeholder", field.placeholder);
  strAdd(result, "helpText", field.helpText);
  strAdd(result, "uiWidget", field.uiWidget);
  if (c.format) strAdd(result, "format", field.format);
  if (c.lengthLimits) {
    numAdd(result, "minLength", field.minLength);
    numAdd(result, "maxLength", field.maxLength);
  }
  if (c.numericRange) {
    numAdd(result, "min", field.min);
    numAdd(result, "max", field.max);
  }
  if (c.step) numAdd(result, "step", field.step);
  if (c.selectionLimits) {
    numAdd(result, "minItems", field.minItems);
    numAdd(result, "maxItems", field.maxItems);
  }
  if (c.allowCustom && field.allowCustom) result.allowCustom = true;
  if (c.pattern) {
    const pat = field.pattern.trim();
    if (pat) {
      result.pattern = pat;
      strAdd(result, "patternMessage", field.patternMessage);
    }
  }
  if (c.allowedDomains) {
    const domains = field.allowedDomainsText
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (domains.length) result.allowedDomains = domains;
  }

  return Object.keys(result).length ? result : undefined;
}

// ── visual ↔ raw conversion ───────────────────────────────────────────────────

function draftToRawJson(field: FieldDraft): string {
  try {
    const v = buildFieldValidation({ ...field, rawMode: false }) ?? {};
    return Object.keys(v).length ? JSON.stringify(v, null, 2) : "{}";
  } catch {
    return "{}";
  }
}

function rawJsonToDraftPatch(
  json: string,
  ft: FieldType,
): Partial<FieldDraft> & { rawMode: false; advancedValidationText: string } {
  const t = json.trim();
  const obj: Record<string, unknown> = t && t !== "{}" ? (JSON.parse(t) as Record<string, unknown>) : {};
  const c = caps(ft);
  const viz = obj.adminVisualization ?? obj.visualization;
  const advanced = Object.fromEntries(Object.entries(obj).filter(([k]) => !KNOWN_KEYS.has(k)));

  return {
    rawMode: false,
    adminVisualization: viz === "bar" || viz === "pie" || viz === "wordcloud" || viz === "list" ? viz : "auto",
    placeholder: c.placeholder ? sv(obj, "placeholder") : "",
    helpText: sv(obj, "helpText"),
    uiWidget: sv(obj, "uiWidget"),
    format: c.format ? sv(obj, "format") : "",
    pattern: c.pattern ? sv(obj, "pattern") : "",
    patternMessage: c.pattern ? sv(obj, "patternMessage") : "",
    minLength: c.lengthLimits ? nv(obj, "minLength") : "",
    maxLength: c.lengthLimits ? nv(obj, "maxLength") : "",
    min: c.numericRange ? nv(obj, "min") : "",
    max: c.numericRange ? nv(obj, "max") : "",
    step: c.step ? nv(obj, "step") : "",
    minItems: c.selectionLimits ? nv(obj, "minItems") : "",
    maxItems: c.selectionLimits ? nv(obj, "maxItems") : "",
    allowCustom: c.allowCustom ? obj.allowCustom === true : false,
    allowedDomainsText:
      c.allowedDomains && Array.isArray(obj.allowedDomains)
        ? (obj.allowedDomains as unknown[]).filter((s): s is string => typeof s === "string").join("\n")
        : "",
    advancedValidationText: Object.keys(advanced).length ? JSON.stringify(advanced, null, 2) : "{}",
  };
}

// ── component ─────────────────────────────────────────────────────────────────

export function FieldConfigEditor({
  field,
  index,
  updateField,
}: {
  field: FieldDraft;
  index: number;
  updateField: (index: number, patch: Partial<FieldDraft>) => void;
}) {
  const [rawError, setRawError] = useState("");
  const c = caps(field.fieldType);

  function toggleMode() {
    if (!field.rawMode) {
      updateField(index, { rawMode: true, rawValidationText: draftToRawJson(field) });
      setRawError("");
    } else {
      try {
        updateField(index, rawJsonToDraftPatch(field.rawValidationText, field.fieldType));
        setRawError("");
      } catch (err) {
        setRawError((err as Error).message);
      }
    }
  }

  /*
   * Two toggle buttons rather than a segmented control of our own: `aria-pressed`
   * is what tells assistive technology which editor is showing, and the primary
   * variant is what shows it to everyone else. The old markup carried neither —
   * it painted an `.active` class and announced two identical plain buttons.
   */
  const modeSwitch = (
    <div class="pk-cluster pk-cluster--between">
      <span class="pk-small">Field configuration</span>
      <div class="pk-cluster" role="group" aria-label="Edit mode">
        <Button
          size="sm"
          variant={field.rawMode ? "secondary" : "primary"}
          aria-pressed={field.rawMode ? "false" : "true"}
          onClick={() => {
            if (field.rawMode) toggleMode();
          }}
        >
          Visual
        </Button>
        <Button
          size="sm"
          variant={field.rawMode ? "primary" : "secondary"}
          aria-pressed={field.rawMode ? "true" : "false"}
          onClick={() => {
            if (!field.rawMode) toggleMode();
          }}
        >
          JSON
        </Button>
      </div>
    </div>
  );

  // ── Raw JSON mode ────────────────────────────────────────────────────────────
  if (field.rawMode) {
    return (
      <div class="pk pk-stack pk-stack--snug">
        {modeSwitch}
        {/*
         * The parse failure belongs on the control that caused it, so it arrives
         * as the Field's invalid state — `aria-invalid` plus a `role="alert"`
         * message the textarea is described by — rather than as a detached
         * banner above it.
         */}
        <Field
          label="Validation JSON"
          help="The full validation and display config. Switch to Visual to parse these settings back into structured fields."
          state={rawError ? "invalid" : undefined}
          message={rawError || undefined}
        >
          {(control) => (
            <Textarea
              {...control}
              class="pk-mono"
              rows={7}
              value={field.rawValidationText}
              placeholder="{}"
              onInput={(e) => updateField(index, { rawValidationText: (e.target as HTMLTextAreaElement).value })}
            />
          )}
        </Field>
      </div>
    );
  }

  // ── Visual mode ──────────────────────────────────────────────────────────────
  return (
    <div class="pk pk-stack pk-stack--snug">
      {modeSwitch}

      {/* Options textarea — choice fields only */}
      {c.options && (
        <Field label="Options" help="One per line.">
          {(control) => (
            <Textarea
              {...control}
              class="pk-mono"
              rows={5}
              value={field.optionsText}
              placeholder={"Option A\nOption B"}
              onInput={(e) => updateField(index, { optionsText: (e.target as HTMLTextAreaElement).value })}
            />
          )}
        </Field>
      )}

      <div class="pk-grid pk-grid--tight">
        {/* Placeholder — not for choice / boolean */}
        {c.placeholder && (
          <Field label="Placeholder">
            {(control) => (
              <TextInput
                {...control}
                value={field.placeholder}
                onInput={(e) => updateField(index, { placeholder: (e.target as HTMLInputElement).value })}
              />
            )}
          </Field>
        )}

        {/* Help text — always visible */}
        <Field label="Help text">
          {(control) => (
            <TextInput
              {...control}
              value={field.helpText}
              onInput={(e) => updateField(index, { helpText: (e.target as HTMLInputElement).value })}
            />
          )}
        </Field>

        {/* Stats view — always visible */}
        <Field label="Stats view">
          {(control) => (
            <Select
              {...control}
              value={field.adminVisualization}
              onChange={(e) =>
                updateField(index, {
                  adminVisualization: (e.target as HTMLSelectElement).value as VisualizationConfig,
                })
              }
            >
              {VIZ_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/* Length limits — text / textarea / email / url */}
        {c.lengthLimits && (
          <>
            <Field label="Min length">
              {(control) => (
                <TextInput
                  {...control}
                  type="number"
                  min="0"
                  value={field.minLength}
                  onInput={(e) => updateField(index, { minLength: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
            <Field label="Max length">
              {(control) => (
                <TextInput
                  {...control}
                  type="number"
                  min="0"
                  value={field.maxLength}
                  onInput={(e) => updateField(index, { maxLength: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
          </>
        )}

        {/* Numeric range — number / date */}
        {c.numericRange && (
          <>
            <Field label="Min">
              {(control) => (
                <TextInput
                  {...control}
                  type="number"
                  value={field.min}
                  onInput={(e) => updateField(index, { min: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
            <Field label="Max">
              {(control) => (
                <TextInput
                  {...control}
                  type="number"
                  value={field.max}
                  onInput={(e) => updateField(index, { max: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
          </>
        )}

        {/* Step — number only */}
        {c.step && (
          <Field label="Step">
            {(control) => (
              <TextInput
                {...control}
                type="number"
                value={field.step}
                onInput={(e) => updateField(index, { step: (e.target as HTMLInputElement).value })}
              />
            )}
          </Field>
        )}

        {/* Selection range — multi_select only */}
        {c.selectionLimits && (
          <>
            <Field label="Min selections">
              {(control) => (
                <TextInput
                  {...control}
                  type="number"
                  min="0"
                  value={field.minItems}
                  onInput={(e) => updateField(index, { minItems: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
            <Field label="Max selections">
              {(control) => (
                <TextInput
                  {...control}
                  type="number"
                  min="0"
                  value={field.maxItems}
                  onInput={(e) => updateField(index, { maxItems: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
          </>
        )}

        {/* Regex pattern + error message — text only */}
        {c.pattern && (
          <>
            <Field label="Pattern" help="A regular expression.">
              {(control) => (
                <TextInput
                  {...control}
                  class="pk-mono"
                  value={field.pattern}
                  onInput={(e) => updateField(index, { pattern: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
            <Field label="Pattern error message">
              {(control) => (
                <TextInput
                  {...control}
                  value={field.patternMessage}
                  onInput={(e) => updateField(index, { patternMessage: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
          </>
        )}

        {/* Widget */}
        <Field label="Widget">
          {(control) => (
            <Select
              {...control}
              value={field.uiWidget}
              onChange={(e) => updateField(index, { uiWidget: (e.target as HTMLSelectElement).value })}
            >
              {UI_WIDGETS.map((w) => (
                <option key={w || "none"} value={w}>
                  {w ? w.replace(/_/g, " ") : "Default"}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/* Format — text-like / choice fields */}
        {c.format && (
          <Field label="Format">
            {(control) => (
              <Select
                {...control}
                value={field.format}
                onChange={(e) => updateField(index, { format: (e.target as HTMLSelectElement).value })}
              >
                {FIELD_FORMATS.map((f) => (
                  <option key={f || "none"} value={f}>
                    {f ? f.replace(/_/g, " ") : "Default"}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      {/* Allow custom answers — select / multi_select. The label wraps the input,
          so the association survives without an id the surrounding list has to
          keep unique per field. */}
      {c.allowCustom && (
        <label class="pk-check">
          <input
            class="pk-check__input"
            type="checkbox"
            checked={field.allowCustom}
            onChange={(e) => updateField(index, { allowCustom: (e.target as HTMLInputElement).checked })}
          />
          <span class="pk-check__label">Allow custom answers</span>
        </label>
      )}

      {/* Allowed email domains — email only */}
      {c.allowedDomains && (
        <Field label="Allowed domains" help="One per line.">
          {(control) => (
            <Textarea
              {...control}
              class="pk-mono"
              rows={2}
              value={field.allowedDomainsText}
              placeholder="example.com"
              onInput={(e) =>
                updateField(index, {
                  allowedDomainsText: (e.target as HTMLTextAreaElement).value,
                })
              }
            />
          )}
        </Field>
      )}
    </div>
  );
}
