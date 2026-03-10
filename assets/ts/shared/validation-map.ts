import { ApiClientError } from "./api-client";

export interface ValidationState {
  globalMessage: string;
  fields: Record<string, string>;
}

function candidateFieldKeys(field: string): string[] {
  const compact = field.replace(/\[\]$/, "");
  const keys = [field, compact];

  if (compact.startsWith("custom.")) {
    keys.push(compact.replace(/^custom\./, ""));
    keys.push(compact.replace(/^custom\./, "").replace(/\.start$|\.end$/, ""));
  }

  if (compact.startsWith("dayAttendance.")) {
    keys.push("dayAttendance");
  }

  if (compact.includes(".")) {
    const short = compact.split(".").pop();
    if (short) {
      keys.push(short);
    }
  }

  return Array.from(new Set(keys.filter((entry) => entry.length > 0)));
}

export function findFieldErrorTarget(form: HTMLFormElement, field: string): HTMLElement | null {
  const errorEls = Array.from(form.querySelectorAll<HTMLElement>("[data-field-error]"));
  const candidates = candidateFieldKeys(field);
  for (const key of candidates) {
    const match = errorEls.find((el) => el.dataset.fieldError === key);
    if (match) {
      return match;
    }
  }
  for (const key of candidates) {
    const match = errorEls.find((el) => {
      const current = el.dataset.fieldError;
      return Boolean(current && current.endsWith(`.${key}`));
    });
    if (match) {
      return match;
    }
  }
  return null;
}

export function normalizeValidation(error: unknown): ValidationState {
  if (!(error instanceof ApiClientError)) {
    return {
      globalMessage: "Unexpected error. Please try again.",
      fields: {},
    };
  }

  const details = error.details;
  const fieldErrors = details?.fieldErrors ?? {};
  const flattened = Object.fromEntries(
    Object.entries(fieldErrors)
      .filter(([, value]) => Array.isArray(value) && value.length > 0)
      .map(([key, value]) => [key, value[0] ?? "Invalid value"]),
  );

  const formError = details?.formErrors?.[0] ?? error.message;
  const globalMessage = formError === "Invalid custom answers" && Object.keys(flattened).length > 0
    ? "Please correct the highlighted custom fields."
    : formError;
  return {
    globalMessage,
    fields: flattened,
  };
}

export function clearFieldErrors(form: HTMLFormElement): void {
  const errorEls = form.querySelectorAll<HTMLElement>("[data-field-error]");
  for (const errorEl of errorEls) {
    errorEl.textContent = "";
  }
}

export function applyFieldErrors(form: HTMLFormElement, fields: Record<string, string>): void {
  clearFieldErrors(form);
  for (const [field, message] of Object.entries(fields)) {
    const target = findFieldErrorTarget(form, field);
    if (target) {
      target.textContent = message;
    }
  }
}
