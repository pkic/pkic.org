import { useState } from "preact/hooks";
import type { AdminFormDetailField } from "../../../types";

export type FieldType = AdminFormDetailField["fieldType"];
export type VisualizationConfig = "auto" | "bar" | "pie" | "wordcloud" | "list";

export interface FieldDraft {
  key: string;
  label: string;
  fieldType: FieldType;
  required: boolean;
  sortOrder: number;
  optionsText: string;
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

  const modeSwitch = (
    <div class="d-flex align-items-center gap-2 mb-3">
      <span class="small text-muted fst-italic">Field configuration</span>
      <div class="adm-field-mode-toggle ms-auto" role="group" aria-label="Edit mode">
        <button
          type="button"
          class={`adm-field-mode-btn${!field.rawMode ? " active" : ""}`}
          onClick={() => {
            if (field.rawMode) toggleMode();
          }}
        >
          Visual
        </button>
        <button
          type="button"
          class={`adm-field-mode-btn${field.rawMode ? " active" : ""}`}
          onClick={() => {
            if (!field.rawMode) toggleMode();
          }}
        >
          JSON
        </button>
      </div>
    </div>
  );

  // ── Raw JSON mode ────────────────────────────────────────────────────────────
  if (field.rawMode) {
    return (
      <div class="mt-3 pt-3 border-top">
        {modeSwitch}
        {rawError && <div class="alert alert-danger small py-1 px-2 mb-2">{rawError}</div>}
        <textarea
          class="form-control form-control-sm mono adm-field-raw-json"
          rows={7}
          value={field.rawValidationText}
          placeholder="{}"
          onInput={(e) => updateField(index, { rawValidationText: (e.target as HTMLTextAreaElement).value })}
        />
        <p class="small text-muted mt-1 mb-0">
          Edit the full validation/display config as JSON. Switch to Visual to parse the settings back into structured
          fields.
        </p>
      </div>
    );
  }

  // ── Visual mode ──────────────────────────────────────────────────────────────
  return (
    <div class="mt-3 pt-3 border-top">
      {modeSwitch}
      <div class="row g-2">
        {/* Options textarea — choice fields only */}
        {c.options && (
          <div class="col-md-4">
            <label class="form-label small fw-semibold">
              Options <span class="fw-normal text-muted">(one per line)</span>
            </label>
            <textarea
              class="form-control form-control-sm mono"
              rows={5}
              value={field.optionsText}
              placeholder={"Option A\nOption B"}
              onInput={(e) => updateField(index, { optionsText: (e.target as HTMLTextAreaElement).value })}
            />
          </div>
        )}

        <div class={c.options ? "col-md-8" : "col-12"}>
          <div class="row g-2">
            {/* Placeholder — not for choice / boolean */}
            {c.placeholder && (
              <div class="col-md-4">
                <label class="form-label small fw-semibold">Placeholder</label>
                <input
                  class="form-control form-control-sm"
                  value={field.placeholder}
                  onInput={(e) => updateField(index, { placeholder: (e.target as HTMLInputElement).value })}
                />
              </div>
            )}

            {/* Help text — always visible */}
            <div class={c.placeholder ? "col-md-4" : "col-md-5"}>
              <label class="form-label small fw-semibold">Help text</label>
              <input
                class="form-control form-control-sm"
                value={field.helpText}
                onInput={(e) => updateField(index, { helpText: (e.target as HTMLInputElement).value })}
              />
            </div>

            {/* Stats view — always visible */}
            <div class="col-md-3">
              <label class="form-label small fw-semibold">Stats view</label>
              <select
                class="form-select form-select-sm"
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
              </select>
            </div>

            {/* Length limits — text / textarea / email / url */}
            {c.lengthLimits && (
              <>
                <div class="col-md-3">
                  <label class="form-label small fw-semibold">Min length</label>
                  <input
                    type="number"
                    min="0"
                    class="form-control form-control-sm"
                    value={field.minLength}
                    onInput={(e) => updateField(index, { minLength: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="col-md-3">
                  <label class="form-label small fw-semibold">Max length</label>
                  <input
                    type="number"
                    min="0"
                    class="form-control form-control-sm"
                    value={field.maxLength}
                    onInput={(e) => updateField(index, { maxLength: (e.target as HTMLInputElement).value })}
                  />
                </div>
              </>
            )}

            {/* Numeric range — number / date */}
            {c.numericRange && (
              <>
                <div class="col-md-3">
                  <label class="form-label small fw-semibold">Min</label>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    value={field.min}
                    onInput={(e) => updateField(index, { min: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="col-md-3">
                  <label class="form-label small fw-semibold">Max</label>
                  <input
                    type="number"
                    class="form-control form-control-sm"
                    value={field.max}
                    onInput={(e) => updateField(index, { max: (e.target as HTMLInputElement).value })}
                  />
                </div>
              </>
            )}

            {/* Step — number only */}
            {c.step && (
              <div class="col-md-3">
                <label class="form-label small fw-semibold">Step</label>
                <input
                  type="number"
                  class="form-control form-control-sm"
                  value={field.step}
                  onInput={(e) => updateField(index, { step: (e.target as HTMLInputElement).value })}
                />
              </div>
            )}

            {/* Selection range — multi_select only */}
            {c.selectionLimits && (
              <>
                <div class="col-md-3">
                  <label class="form-label small fw-semibold">Min selections</label>
                  <input
                    type="number"
                    min="0"
                    class="form-control form-control-sm"
                    value={field.minItems}
                    onInput={(e) => updateField(index, { minItems: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="col-md-3">
                  <label class="form-label small fw-semibold">Max selections</label>
                  <input
                    type="number"
                    min="0"
                    class="form-control form-control-sm"
                    value={field.maxItems}
                    onInput={(e) => updateField(index, { maxItems: (e.target as HTMLInputElement).value })}
                  />
                </div>
              </>
            )}

            {/* Allow custom answers — select / multi_select */}
            {c.allowCustom && (
              <div class="col-auto d-flex align-items-end pb-1">
                <div class="form-check">
                  <input
                    id={`fce-custom-${index}`}
                    type="checkbox"
                    class="form-check-input"
                    checked={field.allowCustom}
                    onChange={(e) => updateField(index, { allowCustom: (e.target as HTMLInputElement).checked })}
                  />
                  <label class="form-check-label small" for={`fce-custom-${index}`}>
                    Allow custom answers
                  </label>
                </div>
              </div>
            )}

            {/* Regex pattern + error message — text only */}
            {c.pattern && (
              <>
                <div class="col-md-4">
                  <label class="form-label small fw-semibold">
                    Pattern <span class="fw-normal text-muted">(regex)</span>
                  </label>
                  <input
                    class="form-control form-control-sm mono"
                    value={field.pattern}
                    onInput={(e) => updateField(index, { pattern: (e.target as HTMLInputElement).value })}
                  />
                </div>
                <div class="col-md-4">
                  <label class="form-label small fw-semibold">Pattern error message</label>
                  <input
                    class="form-control form-control-sm"
                    value={field.patternMessage}
                    onInput={(e) => updateField(index, { patternMessage: (e.target as HTMLInputElement).value })}
                  />
                </div>
              </>
            )}

            {/* Allowed email domains — email only */}
            {c.allowedDomains && (
              <div class="col-md-5">
                <label class="form-label small fw-semibold">
                  Allowed domains <span class="fw-normal text-muted">(one per line)</span>
                </label>
                <textarea
                  class="form-control form-control-sm mono"
                  rows={2}
                  value={field.allowedDomainsText}
                  placeholder="example.com"
                  onInput={(e) =>
                    updateField(index, {
                      allowedDomainsText: (e.target as HTMLTextAreaElement).value,
                    })
                  }
                />
              </div>
            )}

            {/* Widget */}
            <div class="col-md-3">
              <label class="form-label small fw-semibold">Widget</label>
              <select
                class="form-select form-select-sm"
                value={field.uiWidget}
                onChange={(e) => updateField(index, { uiWidget: (e.target as HTMLSelectElement).value })}
              >
                {UI_WIDGETS.map((w) => (
                  <option key={w || "none"} value={w}>
                    {w ? w.replace(/_/g, " ") : "Default"}
                  </option>
                ))}
              </select>
            </div>

            {/* Format — text-like / choice fields */}
            {c.format && (
              <div class="col-md-3">
                <label class="form-label small fw-semibold">Format</label>
                <select
                  class="form-select form-select-sm"
                  value={field.format}
                  onChange={(e) => updateField(index, { format: (e.target as HTMLSelectElement).value })}
                >
                  {FIELD_FORMATS.map((f) => (
                    <option key={f || "none"} value={f}>
                      {f ? f.replace(/_/g, " ") : "Default"}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
