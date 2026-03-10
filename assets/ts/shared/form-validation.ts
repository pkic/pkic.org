import { clearFieldErrors, findFieldErrorTarget } from "./validation-map";

const strictEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const strictEmailMessage = "Please enter a valid email address (for example: name@example.com).";

// Domains that are common personal / consumer email providers.
// When detected, we show an inline advisory — we do NOT block the submission.
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de",
  "outlook.com", "outlook.co.uk",
  "live.com", "live.co.uk", "live.nl", "live.de",
  "msn.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de",
  "icloud.com", "me.com", "mac.com",
  "aol.com",
  "protonmail.com", "proton.me",
  "tutanota.com", "tuta.io",
  "gmx.com", "gmx.de", "gmx.net",
  "mail.com",
  "yandex.com", "yandex.ru",
  "zoho.com",
]);

/**
 * Shows or hides the [data-email-warning] hint element based on whether
 * the typed email address uses a common personal-email domain.
 * Never blocks submission — this is purely advisory.
 */
function applyEmailWarning(field: HTMLInputElement, form: HTMLFormElement): void {
  const warningEl = form.querySelector<HTMLElement>("[data-email-warning]");
  const domain = field.value.trim().split("@")[1]?.toLowerCase() ?? "";
  const isPersonal = domain.length > 0 && PERSONAL_EMAIL_DOMAINS.has(domain);

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

  if (!strictEmailPattern.test(value)) {
    field.setCustomValidity(strictEmailMessage);
    return;
  }

  field.setCustomValidity("");
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

export function installLiveValidation(form: HTMLFormElement, statusEl: HTMLElement): void {
  const handler = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
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

export function validateBeforeSubmit(form: HTMLFormElement, statusEl: HTMLElement): boolean {
  if (form.checkValidity() && validateNativeFields(form)) {
    return true;
  }

  form.classList.add("was-validated");
  validateNativeFields(form);
  // Inline [data-field-error] messages handle per-field feedback;
  // the global banner is reserved for success states only.
  return false;
}
