import { AppError } from "../../errors";
import type { JsonValue } from "../../types";
import { getActiveFormByPurpose, type FormFieldDefinition, type FormPurpose } from "./read";
import { deriveEventAttendanceType, type DayAttendanceSelection } from "../event-days";
import type { DatabaseLike } from "../../types";

type Primitive = string | number | boolean;
export type DateRangeAnswer = { start: string; end: string };
export type CustomAnswerValue = Primitive | Primitive[] | DateRangeAnswer;

interface ShowWhenRules {
  dayAttendanceIn?: string[];
  eventAttendanceTypeIn?: Array<"in_person" | "virtual" | "on_demand">;
}

interface ValidationRules {
  format?: string;
  pattern?: string;
  patternMessage?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  minItems?: number;
  maxItems?: number;
  allowCustom?: boolean;
  allowedDomains?: string[];
  requireTrue?: boolean;
  showWhen?: ShowWhenRules;
}

interface ValidationContext {
  attendanceType?: "in_person" | "virtual" | "on_demand";
  dayAttendance?: DayAttendanceSelection[];
}

const PROFESSIONAL_DOMAINS = [
  "linkedin.com",
  "www.linkedin.com",
  "xing.com",
  "www.xing.com",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addFieldError(errors: Record<string, string[]>, key: string, message: string): void {
  if (!errors[key]) {
    errors[key] = [];
  }
  errors[key].push(message);
}

function parseValidationRules(value: JsonValue | null): ValidationRules {
  if (!isRecord(value)) {
    return {};
  }

  const rules: ValidationRules = {};
  if (typeof value.format === "string") rules.format = value.format;
  if (typeof value.pattern === "string") rules.pattern = value.pattern;
  if (typeof value.patternMessage === "string") rules.patternMessage = value.patternMessage;
  if (typeof value.minLength === "number") rules.minLength = value.minLength;
  if (typeof value.maxLength === "number") rules.maxLength = value.maxLength;
  if (typeof value.min === "number") rules.min = value.min;
  if (typeof value.max === "number") rules.max = value.max;
  if (typeof value.minItems === "number") rules.minItems = value.minItems;
  if (typeof value.maxItems === "number") rules.maxItems = value.maxItems;
  if (typeof value.allowCustom === "boolean") rules.allowCustom = value.allowCustom;
  if (typeof value.requireTrue === "boolean") rules.requireTrue = value.requireTrue;

  if (Array.isArray(value.allowedDomains)) {
    rules.allowedDomains = value.allowedDomains.filter((entry): entry is string => typeof entry === "string");
  }

  if (isRecord(value.showWhen)) {
    const showWhen: ShowWhenRules = {};
    if (Array.isArray(value.showWhen.dayAttendanceIn)) {
      showWhen.dayAttendanceIn = value.showWhen.dayAttendanceIn.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      );
    }
    if (Array.isArray(value.showWhen.eventAttendanceTypeIn)) {
      showWhen.eventAttendanceTypeIn = value.showWhen.eventAttendanceTypeIn.filter(
        (entry): entry is "in_person" | "virtual" | "on_demand" =>
          entry === "in_person" || entry === "virtual" || entry === "on_demand",
      );
    }

    if ((showWhen.dayAttendanceIn && showWhen.dayAttendanceIn.length > 0)
      || (showWhen.eventAttendanceTypeIn && showWhen.eventAttendanceTypeIn.length > 0)) {
      rules.showWhen = showWhen;
    }
  }

  return rules;
}

function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPhoneString(value: string): boolean {
  return /^\+?[0-9()\-\s]{7,25}$/.test(value);
}

function isEmailString(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function optionValues(options: JsonValue | null): string[] {
  if (!Array.isArray(options)) {
    return [];
  }

  const values: string[] = [];
  for (const entry of options) {
    if (typeof entry === "string") {
      values.push(entry);
      continue;
    }

    if (isRecord(entry) && typeof entry.value === "string") {
      values.push(entry.value);
    }
  }

  return values;
}

function isEmptyAnswer(value: CustomAnswerValue | undefined): boolean {
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
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  return undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
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

function hostAllowed(urlString: string, allowedDomains: string[]): boolean {
  try {
    const url = new URL(urlString);
    if (!(url.protocol === "http:" || url.protocol === "https:")) return false;

    const host = url.hostname.toLowerCase();
    return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function normalizeAnswer(field: FormFieldDefinition, value: unknown, rules: ValidationRules): CustomAnswerValue | undefined {
  if (rules.format === "date_range") return toDateRange(value);

  switch (field.fieldType) {
    case "boolean":
      return toBooleanValue(value);
    case "number":
      return toNumberValue(value);
    case "multi_select":
      return toStringArray(value);
    default:
      return toStringValue(value);
  }
}

function isFieldVisible(rules: ValidationRules, context: ValidationContext): boolean {
  if (!rules.showWhen) {
    return true;
  }

  const dayModes = new Set((context.dayAttendance ?? []).map((entry) => entry.attendanceType));
  const eventMode = context.attendanceType ?? deriveEventAttendanceType(context.dayAttendance) ?? undefined;

  if (rules.showWhen.dayAttendanceIn && rules.showWhen.dayAttendanceIn.length > 0) {
    const matched = rules.showWhen.dayAttendanceIn.some((mode) => dayModes.has(mode));
    if (!matched) {
      return false;
    }
  }

  if (rules.showWhen.eventAttendanceTypeIn && rules.showWhen.eventAttendanceTypeIn.length > 0) {
    if (!eventMode || !rules.showWhen.eventAttendanceTypeIn.includes(eventMode)) {
      return false;
    }
  }

  return true;
}

function validateAnswer(
  field: FormFieldDefinition,
  value: CustomAnswerValue | undefined,
  rules: ValidationRules,
  errors: Record<string, string[]>,
): void {
  if (isEmptyAnswer(value)) {
    if (field.required) addFieldError(errors, field.key, `${field.label} is required`);
    return;
  }

  if (typeof value === "boolean") {
    if (rules.requireTrue && value !== true) addFieldError(errors, field.key, `${field.label} must be accepted`);
    return;
  }

  if (typeof value === "number") {
    if (rules.format === "integer" && !Number.isInteger(value)) addFieldError(errors, field.key, `${field.label} must be an integer`);
    if (rules.min !== undefined && value < rules.min) addFieldError(errors, field.key, `${field.label} must be at least ${rules.min}`);
    if (rules.max !== undefined && value > rules.max) addFieldError(errors, field.key, `${field.label} must be at most ${rules.max}`);
    return;
  }

  if (Array.isArray(value)) {
    if (rules.minItems !== undefined && value.length < rules.minItems) {
      addFieldError(errors, field.key, `${field.label} must include at least ${rules.minItems} selections`);
    }
    if (rules.maxItems !== undefined && value.length > rules.maxItems) {
      addFieldError(errors, field.key, `${field.label} can include at most ${rules.maxItems} selections`);
    }

    const options = optionValues(field.options);
    if (options.length > 0 && rules.allowCustom !== true) {
      for (const entry of value) {
        if (!options.includes(String(entry))) {
          addFieldError(errors, field.key, `${field.label} contains an invalid selection`);
          break;
        }
      }
    }
    return;
  }

  if (typeof value === "object") {
    if (!isDateString(value.start) || !isDateString(value.end)) {
      addFieldError(errors, field.key, `${field.label} must contain valid dates`);
      return;
    }
    if (value.start > value.end) addFieldError(errors, field.key, `${field.label} start date must be before end date`);
    return;
  }

  if (typeof value === "string") {
    if (rules.minLength !== undefined && value.length < rules.minLength) addFieldError(errors, field.key, `${field.label} must be at least ${rules.minLength} characters`);
    if (rules.maxLength !== undefined && value.length > rules.maxLength) addFieldError(errors, field.key, `${field.label} must be at most ${rules.maxLength} characters`);

    if (rules.pattern) {
      try {
        const regex = new RegExp(rules.pattern);
        if (!regex.test(value)) addFieldError(errors, field.key, rules.patternMessage ?? `${field.label} has invalid format`);
      } catch {
        addFieldError(errors, field.key, `${field.label} has invalid validation pattern configuration`);
      }
    }

    if (rules.format === "email" && !isEmailString(value)) addFieldError(errors, field.key, `${field.label} must be a valid email address`);
    if (rules.format === "phone" && !isPhoneString(value)) addFieldError(errors, field.key, `${field.label} must be a valid phone number`);
    if (rules.format === "date" && !isDateString(value)) addFieldError(errors, field.key, `${field.label} must be a valid date`);

    if (rules.format === "professional_profile") {
      const allowed = rules.allowedDomains && rules.allowedDomains.length > 0 ? rules.allowedDomains : PROFESSIONAL_DOMAINS;
      if (!hostAllowed(value, allowed)) addFieldError(errors, field.key, `${field.label} must be a supported professional profile URL`);
    }

    if ((field.fieldType === "select" || field.fieldType === "multi_select") && rules.allowCustom !== true) {
      const options = optionValues(field.options);
      if (options.length > 0 && !options.includes(value)) addFieldError(errors, field.key, `${field.label} must be one of the configured options`);
    }
  }
}

export async function validateCustomAnswersByPurpose(
  db: DatabaseLike,
  payload: {
    eventId: string;
    purpose: FormPurpose;
    customAnswers?: Record<string, unknown>;
    context?: ValidationContext;
  },
): Promise<Record<string, CustomAnswerValue>> {
  const answers = payload.customAnswers ?? {};
  const answerKeys = Object.keys(answers);
  const form = await getActiveFormByPurpose(db, payload.eventId, payload.purpose);

  if (!form) {
    if (answerKeys.length > 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Custom answers are not configured for this form", {
        fieldErrors: { customAnswers: ["No active form configured for this event flow"] },
      });
    }
    return {};
  }

  const fieldsByKey = new Map(form.fields.map((field) => [field.key, field]));
  const fieldErrors: Record<string, string[]> = {};
  const normalized: Record<string, CustomAnswerValue> = {};

  for (const key of answerKeys) {
    if (!fieldsByKey.has(key)) addFieldError(fieldErrors, key, "Unknown field for this form");
  }

  for (const field of form.fields) {
    const rules = parseValidationRules(field.validation);
    const visible = isFieldVisible(rules, payload.context ?? {});
    if (!visible) {
      continue;
    }

    const raw = answers[field.key];
    const normalizedValue = normalizeAnswer(field, raw, rules);
    validateAnswer(field, normalizedValue, rules, fieldErrors);

    if (!isEmptyAnswer(normalizedValue)) {
      normalized[field.key] = normalizedValue as CustomAnswerValue;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid custom answers", { fieldErrors });
  }

  return normalized;
}
