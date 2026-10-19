import type { FormFieldType } from "./schemas/forms";
import { formFieldOptionValues, isAllowedProfileUrl, type FormFieldRules } from "./schemas/form-field-rules";

/**
 * How one answer to one form field is read and judged. Every place that takes
 * an answer — a form submission, a live session poll — normalizes and checks
 * it here, so a question accepts the same answers wherever it is asked.
 */

type Primitive = string | number | boolean;
export type DateRangeAnswer = { start: string; end: string };
export type CustomAnswerValue = Primitive | Primitive[] | DateRangeAnswer;

/** What answer rules read from a field definition. */
export interface AnswerableFormField {
  key: string;
  label: string;
  fieldType: FormFieldType;
  required: boolean;
  options?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPhoneString(value: string): boolean {
  return /^\+?[0-9()\-\s]{7,25}$/.test(value);
}

function isEmailString(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isEmptyFormAnswer(value: CustomAnswerValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return value.start.trim().length === 0 || value.end.trim().length === 0;
  return false;
}

function toDateRange(value: unknown): DateRangeAnswer | undefined {
  if (isRecord(value) && typeof value.start === "string" && typeof value.end === "string") {
    return { start: value.start.trim(), end: value.end.trim() };
  }
  if (typeof value === "string") {
    const [start, end] = value.trim().split("/", 2);
    if (start && end) return { start: start.trim(), end: end.trim() };
  }
  return undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
    return Array.from(new Set(normalized));
  }
  if (typeof value === "string" && value.trim().length > 0) return [value.trim()];
  return undefined;
}

function toBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true" || value === "1" || value === "on") return true;
    if (value === "false" || value === "0") return false;
  }
  return undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** The answer in the shape its field stores, or undefined when nothing usable was given. */
export function normalizeFormAnswer(
  field: AnswerableFormField,
  value: unknown,
  rules: FormFieldRules,
): CustomAnswerValue | undefined {
  if (rules.format === "date_range") return toDateRange(value);
  switch (field.fieldType) {
    case "boolean":
      return toBooleanValue(value);
    case "number":
      return toNumberValue(value);
    case "multi_select":
      return toStringArray(value);
    default:
      return typeof value === "string" ? value.trim() : undefined;
  }
}

/**
 * The scores a rating widget offers, or null for a plain number. NPS is the
 * fixed 0–10 scale; rating stars default to 1–5 unless the field bounds them.
 */
export function ratingScale(rules: FormFieldRules): { min: number; max: number } | null {
  if (rules.uiWidget === "nps") return { min: 0, max: 10 };
  if (rules.uiWidget === "rating_stars") return { min: rules.min ?? 1, max: rules.max ?? 5 };
  return null;
}

function numberProblems(field: AnswerableFormField, value: number, rules: FormFieldRules): string[] {
  const problems: string[] = [];
  const scale = ratingScale(rules);
  if (scale && (!Number.isInteger(value) || value < scale.min || value > scale.max))
    return [`${field.label} must be a score from ${scale.min} to ${scale.max}`];
  if (rules.format === "integer" && !Number.isInteger(value)) problems.push(`${field.label} must be an integer`);
  if (rules.min !== undefined && value < rules.min) problems.push(`${field.label} must be at least ${rules.min}`);
  if (rules.max !== undefined && value > rules.max) problems.push(`${field.label} must be at most ${rules.max}`);
  return problems;
}

function selectionProblems(field: AnswerableFormField, value: Primitive[], rules: FormFieldRules): string[] {
  const problems: string[] = [];
  if (rules.minItems !== undefined && value.length < rules.minItems)
    problems.push(`${field.label} must include at least ${rules.minItems} selections`);
  if (rules.maxItems !== undefined && value.length > rules.maxItems)
    problems.push(`${field.label} can include at most ${rules.maxItems} selections`);
  const options = formFieldOptionValues(field.options);
  if (options.length > 0 && rules.allowCustom !== true && value.some((entry) => !options.includes(String(entry))))
    problems.push(`${field.label} contains an invalid selection`);
  return problems;
}

function textProblems(field: AnswerableFormField, value: string, rules: FormFieldRules): string[] {
  const problems: string[] = [];
  if (rules.minLength !== undefined && value.length < rules.minLength)
    problems.push(`${field.label} must be at least ${rules.minLength} characters`);
  if (rules.maxLength !== undefined && value.length > rules.maxLength)
    problems.push(`${field.label} must be at most ${rules.maxLength} characters`);
  if (rules.pattern) {
    try {
      if (!new RegExp(rules.pattern).test(value))
        problems.push(rules.patternMessage ?? `${field.label} has invalid format`);
    } catch {
      problems.push(`${field.label} has invalid validation pattern configuration`);
    }
  }
  if (rules.format === "email" && !isEmailString(value)) problems.push(`${field.label} must be a valid email address`);
  if (rules.format === "phone" && !isPhoneString(value)) problems.push(`${field.label} must be a valid phone number`);
  if (rules.format === "date" && !isDateString(value)) problems.push(`${field.label} must be a valid date`);
  if (rules.format === "professional_profile" && !isAllowedProfileUrl(value, rules.allowedDomains))
    problems.push(`${field.label} must be a supported professional profile URL`);
  if ((field.fieldType === "select" || field.fieldType === "multi_select") && rules.allowCustom !== true) {
    const options = formFieldOptionValues(field.options);
    if (options.length > 0 && !options.includes(value))
      problems.push(`${field.label} must be one of the configured options`);
  }
  return problems;
}

/** Why a normalized answer is refused; empty when the field accepts it. */
export function formAnswerProblems(
  field: AnswerableFormField,
  value: CustomAnswerValue | undefined,
  rules: FormFieldRules,
): string[] {
  if (isEmptyFormAnswer(value)) return field.required ? [`${field.label} is required`] : [];
  if (typeof value === "boolean") return rules.requireTrue && value !== true ? [`${field.label} must be accepted`] : [];
  if (typeof value === "number") return numberProblems(field, value, rules);
  if (Array.isArray(value)) return selectionProblems(field, value, rules);
  if (typeof value === "object") {
    if (!isDateString(value.start) || !isDateString(value.end)) return [`${field.label} must contain valid dates`];
    return value.start > value.end ? [`${field.label} start date must be before end date`] : [];
  }
  if (typeof value === "string") return textProblems(field, value, rules);
  return [];
}
