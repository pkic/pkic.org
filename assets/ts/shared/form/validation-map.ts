import { applyFieldState, type FieldState } from "../../ui/field-state";
import { ZodError } from "zod";
import { ApiClientError } from "../api-client";
import { apiValidationErrorDetailsSchema } from "../../../shared/schemas/api-common";

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

/** The message slot for a control, for callers that hold the control. */
export function findControlFieldError(control: Element): HTMLElement | null {
  return control.closest(".pk-field")?.querySelector<HTMLElement>("[data-field-error]") ?? null;
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
  if (error instanceof ZodError) {
    const flat = error.flatten();
    const fields = Object.fromEntries(
      Object.entries(flat.fieldErrors)
        .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
        .map(([key, msgs]) => [key, (msgs as string[])[0] ?? "Invalid value"]),
    );
    // Keep the full path for controls inside objects and repeatable rows.
    // The parent aliases remain for editors that display one error per group.
    for (const issue of error.issues) {
      if (issue.path.length === 0) continue;
      const path = issue.path.map(String).join(".");
      fields[path] ??= issue.message;
    }
    return {
      globalMessage: flat.formErrors[0] ?? Object.values(fields)[0] ?? "Please correct the highlighted fields.",
      fields,
    };
  }

  if (!(error instanceof ApiClientError)) {
    return {
      globalMessage: "Unexpected error. Please try again.",
      fields: {},
    };
  }

  const detailsResult = apiValidationErrorDetailsSchema.safeParse(error.details);
  const details = detailsResult.success ? detailsResult.data : undefined;
  const fieldErrors = details?.fieldErrors ?? {};
  const flattened = Object.fromEntries(
    Object.entries(fieldErrors)
      .filter(([, value]) => Array.isArray(value) && value.length > 0)
      .map(([key, value]) => [key, value[0] ?? "Invalid value"]),
  );

  return {
    globalMessage: details?.formErrors?.[0] ?? error.message,
    fields: flattened,
  };
}

/**
 * A refusal said in one sentence, for a command that has no fields of its own
 * to mark (a row menu, a day roster, a button). A field's reason is more
 * specific than the envelope's summary, so it is preferred; the summary — the
 * server's own sentence for a domain refusal — is the fallback.
 */
export function refusalSentence(error: unknown): string {
  const refusal = normalizeValidation(error);
  return Object.values(refusal.fields)[0] ?? refusal.globalMessage;
}

/**
 * Writes a field message and moves its `pk-field` into the matching state.
 *
 * `Field` renders no message element at all until it has something to report,
 * so a server-rendered slot hides itself to match: an empty but visible
 * paragraph is announced on every `aria-live` update and reserves a line under
 * the control. The state modifier travels with the message because it is what
 * colors the border and draws the mark — a template that ships the right
 * markup still looks unstyled until something sets it.
 */
export function setFieldMessage(element: HTMLElement | null, message: string, state: FieldState = "invalid"): void {
  if (!element) return;
  element.textContent = message;
  element.hidden = message.length === 0;
  applyFieldState(element.closest(".pk-field"), message.length > 0 ? state : null);
}

export function clearFieldErrors(form: HTMLFormElement): void {
  const errorEls = form.querySelectorAll<HTMLElement>("[data-field-error]");
  for (const errorEl of errorEls) {
    setFieldMessage(errorEl, "");
  }
}

export function applyFieldErrors(form: HTMLFormElement, fields: Record<string, string>): void {
  clearFieldErrors(form);
  for (const [field, message] of Object.entries(fields)) {
    setFieldMessage(findFieldErrorTarget(form, field), message);
  }
}
