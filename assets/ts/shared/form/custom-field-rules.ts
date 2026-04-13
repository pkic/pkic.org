import type { FormField } from "../types";

export type FieldOption = { value: string; label: string };

export interface FieldRules {
  placeholder?: string;
  helpText?: string;
  uiWidget?: string;
  format?: string;
  pattern?: string;
  patternMessage?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  minItems?: number;
  maxItems?: number;
  allowCustom?: boolean;
  allowedDomains?: string[];
  showWhen?: {
    dayAttendanceIn?: string[];
    eventAttendanceTypeIn?: Array<"in_person" | "virtual" | "on_demand">;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readRules(field: FormField): FieldRules {
  const value = field.validation;
  if (!isRecord(value)) {
    return {};
  }

  const rules: FieldRules = {};
  if (typeof value.placeholder === "string") rules.placeholder = value.placeholder;
  if (typeof value.helpText === "string") rules.helpText = value.helpText;
  if (typeof value.uiWidget === "string") rules.uiWidget = value.uiWidget;
  if (typeof value.format === "string") rules.format = value.format;
  if (typeof value.pattern === "string") rules.pattern = value.pattern;
  if (typeof value.patternMessage === "string") rules.patternMessage = value.patternMessage;
  if (typeof value.minLength === "number") rules.minLength = value.minLength;
  if (typeof value.maxLength === "number") rules.maxLength = value.maxLength;
  if (typeof value.min === "number") rules.min = value.min;
  if (typeof value.max === "number") rules.max = value.max;
  if (typeof value.step === "number") rules.step = value.step;
  if (typeof value.minItems === "number") rules.minItems = value.minItems;
  if (typeof value.maxItems === "number") rules.maxItems = value.maxItems;
  if (typeof value.allowCustom === "boolean") rules.allowCustom = value.allowCustom;
  if (Array.isArray(value.allowedDomains)) {
    rules.allowedDomains = value.allowedDomains.filter((entry): entry is string => typeof entry === "string");
  }
  if (isRecord(value.showWhen)) {
    const showWhen: NonNullable<FieldRules["showWhen"]> = {};
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
    if (
      (showWhen.dayAttendanceIn && showWhen.dayAttendanceIn.length > 0)
      || (showWhen.eventAttendanceTypeIn && showWhen.eventAttendanceTypeIn.length > 0)
    ) {
      rules.showWhen = showWhen;
    }
  }

  return rules;
}

export function isFieldVisible(
  rules: FieldRules,
  context: {
    dayAttendance: Array<{ attendanceType: string }>;
    eventAttendanceType?: "in_person" | "virtual" | "on_demand";
  },
): boolean {
  if (!rules.showWhen) {
    return true;
  }

  if (rules.showWhen.dayAttendanceIn && rules.showWhen.dayAttendanceIn.length > 0) {
    const selected = new Set(context.dayAttendance.map((entry) => entry.attendanceType));
    const matched = rules.showWhen.dayAttendanceIn.some((mode) => selected.has(mode));
    if (!matched) {
      return false;
    }
  }

  if (rules.showWhen.eventAttendanceTypeIn && rules.showWhen.eventAttendanceTypeIn.length > 0) {
    if (!context.eventAttendanceType || !rules.showWhen.eventAttendanceTypeIn.includes(context.eventAttendanceType)) {
      return false;
    }
  }

  return true;
}

export function optionsFor(field: FormField): FieldOption[] {
  if (!Array.isArray(field.options)) {
    return [];
  }

  const options: FieldOption[] = [];
  for (const entry of field.options) {
    if (typeof entry === "string") {
      options.push({ value: entry, label: entry });
      continue;
    }

    if (isRecord(entry) && typeof entry.value === "string") {
      options.push({
        value: entry.value,
        label: typeof entry.label === "string" && entry.label.trim().length > 0 ? entry.label.trim() : entry.value,
      });
    }
  }

  return options;
}

