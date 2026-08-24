import { AppError } from "../../errors";
import { getActiveFormByPurpose, type ActiveFormDefinition, type FormFieldDefinition, type FormPurpose } from "./read";
import { deriveEventAttendanceType, type DayAttendanceSelection } from "../event-days";
import type { DatabaseLike } from "../../types";
import type { AttendanceType } from "../../../../assets/shared/schemas/registration";
import {
  formFieldOptionValues,
  isAllowedProfileUrl,
  isFormFieldVisible,
  parseFormFieldRules,
  type FormFieldRules,
} from "../../../../assets/shared/schemas/form-field-rules";

type Primitive = string | number | boolean;
export type DateRangeAnswer = { start: string; end: string };
export type CustomAnswerValue = Primitive | Primitive[] | DateRangeAnswer;

export interface ValidationContext {
  attendanceType?: AttendanceType;
  dayAttendance?: DayAttendanceSelection[];
}

export interface ValidatedCustomAnswers {
  answers: Record<string, CustomAnswerValue>;
  form: ActiveFormDefinition | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addFieldError(errors: Record<string, string[]>, key: string, message: string): void {
  if (!errors[key]) {
    errors[key] = [];
  }
  errors[key].push(message);
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

function normalizeAnswer(
  field: FormFieldDefinition,
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
      return toStringValue(value);
  }
}

function validateAnswer(
  field: FormFieldDefinition,
  value: CustomAnswerValue | undefined,
  rules: FormFieldRules,
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
    if (rules.format === "integer" && !Number.isInteger(value))
      addFieldError(errors, field.key, `${field.label} must be an integer`);
    if (rules.min !== undefined && value < rules.min)
      addFieldError(errors, field.key, `${field.label} must be at least ${rules.min}`);
    if (rules.max !== undefined && value > rules.max)
      addFieldError(errors, field.key, `${field.label} must be at most ${rules.max}`);
    return;
  }

  if (Array.isArray(value)) {
    if (rules.minItems !== undefined && value.length < rules.minItems) {
      addFieldError(errors, field.key, `${field.label} must include at least ${rules.minItems} selections`);
    }
    if (rules.maxItems !== undefined && value.length > rules.maxItems) {
      addFieldError(errors, field.key, `${field.label} can include at most ${rules.maxItems} selections`);
    }

    const options = formFieldOptionValues(field.options);
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
    if (rules.minLength !== undefined && value.length < rules.minLength)
      addFieldError(errors, field.key, `${field.label} must be at least ${rules.minLength} characters`);
    if (rules.maxLength !== undefined && value.length > rules.maxLength)
      addFieldError(errors, field.key, `${field.label} must be at most ${rules.maxLength} characters`);

    if (rules.pattern) {
      try {
        const regex = new RegExp(rules.pattern);
        if (!regex.test(value))
          addFieldError(errors, field.key, rules.patternMessage ?? `${field.label} has invalid format`);
      } catch {
        addFieldError(errors, field.key, `${field.label} has invalid validation pattern configuration`);
      }
    }

    if (rules.format === "email" && !isEmailString(value))
      addFieldError(errors, field.key, `${field.label} must be a valid email address`);
    if (rules.format === "phone" && !isPhoneString(value))
      addFieldError(errors, field.key, `${field.label} must be a valid phone number`);
    if (rules.format === "date" && !isDateString(value))
      addFieldError(errors, field.key, `${field.label} must be a valid date`);

    if (rules.format === "professional_profile") {
      if (!isAllowedProfileUrl(value, rules.allowedDomains))
        addFieldError(errors, field.key, `${field.label} must be a supported professional profile URL`);
    }

    if ((field.fieldType === "select" || field.fieldType === "multi_select") && rules.allowCustom !== true) {
      const options = formFieldOptionValues(field.options);
      if (options.length > 0 && !options.includes(value))
        addFieldError(errors, field.key, `${field.label} must be one of the configured options`);
    }
  }
}

/**
 * Canonical validation/normalization for any portal-managed form. Callers
 * resolve the appropriate form (event-scoped or global) and reuse this one
 * implementation so required, visibility, type, option, and format rules
 * cannot drift between APIs.
 */
export function validateCustomAnswersAgainstForm(
  form: ActiveFormDefinition,
  payload: {
    customAnswers?: Record<string, unknown>;
    context?: ValidationContext;
    errorStatus?: number;
  },
): Record<string, CustomAnswerValue> {
  const answers = payload.customAnswers ?? {};
  const answerKeys = Object.keys(answers);

  const fieldsByKey = new Map(form.fields.map((field) => [field.key, field]));
  const fieldErrors: Record<string, string[]> = {};
  const normalized: Record<string, CustomAnswerValue> = {};

  for (const key of answerKeys) {
    if (!fieldsByKey.has(key)) addFieldError(fieldErrors, key, "Unknown field for this form");
  }

  for (const field of form.fields) {
    const rules = parseFormFieldRules(field.validation);
    const context = payload.context ?? {};
    const visible = isFormFieldVisible(rules, {
      dayAttendanceTypes: context.dayAttendance?.map((entry) => entry.attendanceType),
      eventAttendanceType: context.attendanceType ?? deriveEventAttendanceType(context.dayAttendance) ?? undefined,
    });
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
    throw new AppError(payload.errorStatus ?? 400, "VALIDATION_ERROR", "Invalid custom answers", { fieldErrors });
  }

  return normalized;
}

export async function validateCustomAnswersForSubmission(
  db: DatabaseLike,
  payload: {
    eventId: string;
    purpose: FormPurpose;
    customAnswers?: Record<string, unknown>;
    context?: ValidationContext;
  },
): Promise<ValidatedCustomAnswers> {
  const form = await getActiveFormByPurpose(db, payload.eventId, payload.purpose);

  if (!form) {
    if (Object.keys(payload.customAnswers ?? {}).length > 0) {
      throw new AppError(400, "VALIDATION_ERROR", "Custom answers are not configured for this form", {
        fieldErrors: { customAnswers: ["No active form configured for this event flow"] },
      });
    }
    return { answers: {}, form: null };
  }

  return {
    answers: validateCustomAnswersAgainstForm(form, payload),
    form,
  };
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
  return (await validateCustomAnswersForSubmission(db, payload)).answers;
}
