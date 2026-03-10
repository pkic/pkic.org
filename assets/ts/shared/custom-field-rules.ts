import type { FormField } from "./types";

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

function professionalUrlAllowed(value: string, allowedDomains: string[]): boolean {
  try {
    const url = new URL(value);
    if (!(url.protocol === "http:" || url.protocol === "https:")) {
      return false;
    }

    const host = url.hostname.toLowerCase();
    return allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function wireStringValidation(input: HTMLInputElement | HTMLTextAreaElement, rules: FieldRules): void {
  const validate = () => {
    const value = input.value.trim();
    if (value.length === 0) {
      input.setCustomValidity("");
      return;
    }

    if (rules.format === "phone" && !/^\+?[0-9()\-\s]{7,25}$/.test(value)) {
      input.setCustomValidity("Please provide a valid phone number.");
      return;
    }

    if (rules.format === "professional_profile") {
      const allowed = rules.allowedDomains && rules.allowedDomains.length > 0 ? rules.allowedDomains : PROFESSIONAL_DOMAINS;
      if (!professionalUrlAllowed(value, allowed)) {
        input.setCustomValidity("Please provide a supported professional profile URL.");
        return;
      }
    }

    if (rules.pattern) {
      try {
        const regex = new RegExp(rules.pattern);
        if (!regex.test(value)) {
          input.setCustomValidity(rules.patternMessage ?? "This value does not match the expected format.");
          return;
        }
      } catch {
        input.setCustomValidity("Validation pattern is not configured correctly.");
        return;
      }
    }

    input.setCustomValidity("");
  };

  input.addEventListener("input", validate);
  input.addEventListener("blur", validate);
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

export function createHelpText(rules: FieldRules): HTMLElement | null {
  if (!rules.helpText || rules.helpText.trim().length === 0) {
    return null;
  }
  const help = document.createElement("div");
  help.className = "form-text";
  help.textContent = rules.helpText;
  return help;
}

export function applyCommonAttributes(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  field: FormField,
  rules: FieldRules,
): void {
  element.required = field.required;

  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && rules.placeholder) {
    element.placeholder = rules.placeholder;
  }

  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && rules.minLength !== undefined) {
    element.minLength = rules.minLength;
  }

  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && rules.maxLength !== undefined) {
    element.maxLength = rules.maxLength;
  }

  if (element instanceof HTMLInputElement && rules.min !== undefined) {
    element.min = String(rules.min);
  }

  if (element instanceof HTMLInputElement && rules.max !== undefined) {
    element.max = String(rules.max);
  }

  if (element instanceof HTMLInputElement && rules.step !== undefined) {
    element.step = String(rules.step);
  }

  if (element instanceof HTMLInputElement && rules.pattern) {
    element.pattern = rules.pattern;
    if (rules.patternMessage) {
      element.title = rules.patternMessage;
    }
  }

  if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && rules.format) {
    // iso_country is handled by a dedicated <select> widget — no string validation needed.
    if (rules.format !== "iso_country") {
      wireStringValidation(element, rules);
    }
  }
}
