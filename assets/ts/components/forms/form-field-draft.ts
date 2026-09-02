/**
 * A form field's draft as the editor holds it, and the two-way mapping
 * between that draft and the shared field-rules contract: the visual
 * controls build rules, rules spread back over the controls, and the raw
 * JSON view is the same rules as text. Pure functions; the editor renders.
 */
import type { FormFieldDefinition, FormFieldOptionSource } from "../../../shared/schemas/forms";
import { type FormFieldRules } from "../../../shared/schemas/form-field-rules";

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

export function caps(ft: FieldType): Caps {
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

/**
 * The rules the visual controls describe, as the contract reads them. The
 * advanced overflow is authored by the JSON editor and is always valid JSON;
 * should it not be, the parent's save reports it, and the live check simply
 * reads the controls.
 */
export function visualRules(field: FieldDraft): Record<string, unknown> {
  try {
    return buildFieldValidation({ ...field, rawMode: false }) ?? {};
  } catch {
    return {};
  }
}

// ── visual ↔ raw conversion ───────────────────────────────────────────────────

export function draftToRawJson(field: FieldDraft): string {
  try {
    const v = buildFieldValidation({ ...field, rawMode: false }) ?? {};
    return Object.keys(v).length ? JSON.stringify(v, null, 2) : "{}";
  } catch {
    return "{}";
  }
}

/** Spreads rules the contract accepted over the visual controls; what they cannot show goes to the overflow. */
export function rulesToDraftPatch(
  rules: FormFieldRules,
  ft: FieldType,
): Partial<FieldDraft> & { rawMode: false; advancedValidationText: string } {
  const obj: Record<string, unknown> = rules;
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
