import { clearFieldErrors, findFieldErrorTarget } from "./validation-map";
import { normalizedEmailSchema } from "../../../shared/schemas/api-common";
import { isPersonalEmailAddress } from "../../../shared/constants/email-domains";

/**
 * Shows or hides the [data-email-warning] hint element based on whether
 * the typed email address uses a common personal-email domain.
 * Never blocks submission — this is purely advisory.
 */
function applyEmailWarning(field: HTMLInputElement, form: HTMLFormElement): void {
  const warningEl = form.querySelector<HTMLElement>("[data-email-warning]");
  const isPersonal = isPersonalEmailAddress(field.value);

  if (isPersonal) {
    // data attribute lets CSS neutralise Bootstrap's green :valid ring
    field.dataset.personalEmail = "true";
    if (warningEl) warningEl.classList.remove("d-none");
  } else {
    delete field.dataset.personalEmail;
    if (warningEl) warningEl.classList.add("d-none");
  }
}

function applyEmailValidity(field: HTMLInputElement): void {
  if (field.type !== "email") {
    return;
  }

  const value = field.value.trim();
  if (value.length === 0) {
    field.setCustomValidity("");
    return;
  }

  const result = normalizedEmailSchema.safeParse(value);
  field.setCustomValidity(result.success ? "" : (result.error.issues[0]?.message ?? "Invalid email address"));
}

function writeFieldError(form: HTMLFormElement, name: string, message: string): void {
  const target = findFieldErrorTarget(form, name);
  if (target) {
    target.textContent = message;
  }
}

function validateNativeFields(form: HTMLFormElement): boolean {
  clearFieldErrors(form);
  const fields = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[name]");
  let allValid = true;

  for (const field of Array.from(fields)) {
    if (field.disabled) {
      continue;
    }

    if (field instanceof HTMLInputElement) {
      applyEmailValidity(field);
    }

    if (!field.checkValidity()) {
      allValid = false;
      writeFieldError(form, field.name, field.validationMessage || "Invalid value");
    }
  }

  return allValid;
}

export function installLiveValidation(form: HTMLFormElement, _statusEl: HTMLElement): void {
  const handler = (event: Event) => {
    const target = event.target;
    if (!(
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement
    )) {
      return;
    }
    if (!target.name) {
      return;
    }

    if (target instanceof HTMLInputElement) {
      applyEmailValidity(target);
      if (target.type === "email") {
        applyEmailWarning(target, form);
      }
    }

    if (target.checkValidity()) {
      writeFieldError(form, target.name, "");
      return;
    }

    form.classList.add("was-validated");
    writeFieldError(form, target.name, target.validationMessage || "Invalid value");
    // Do NOT call setStatus here — per-field inline errors are sufficient
    // feedback during live typing. The global banner is reserved for
    // step-advance failures and submission errors only.
  };

  form.addEventListener("input", handler);
  form.addEventListener("change", handler);
  form.addEventListener("blur", handler, true);
}

/**
 * Clears the global status banner if it is currently showing an error.
 * Call this when the user corrects their input and successfully advances a step.
 */
export function clearStatus(target: HTMLElement): void {
  if (target.dataset.state === "error") {
    target.textContent = "";
    target.classList.add("visually-hidden");
    target.classList.remove("alert-danger", "alert-success");
    delete target.dataset.state;
  }
}

export function validateBeforeSubmit(form: HTMLFormElement, _statusEl: HTMLElement): boolean {
  if (form.checkValidity() && validateNativeFields(form)) {
    return true;
  }

  form.classList.add("was-validated");
  validateNativeFields(form);
  // Inline [data-field-error] messages handle per-field feedback;
  // the global banner is reserved for success states only.
  return false;
}
