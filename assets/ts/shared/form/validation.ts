import { clearFieldErrors, findControlFieldError, findFieldErrorTarget, setFieldMessage } from "./validation-map";
import { applyFieldState, type FieldState } from "../../ui/field-state";
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
    // The advisory state reads this back: a personal domain is worth flagging
    // but never blocks a submission, so it must not become `invalid`.
    field.dataset.personalEmail = "true";
  } else {
    delete field.dataset.personalEmail;
  }

  if (!warningEl) return;
  warningEl.hidden = !isPersonal;
}

function applyEmailValidity(field: HTMLInputElement): void {
  if (field.type !== "email") {
    return;
  }

  const value = field.value.trim();
  if (value.length === 0) {
    if (field.dataset.emailFormatError === "true") {
      field.setCustomValidity("");
      delete field.dataset.emailFormatError;
    }
    return;
  }

  const result = normalizedEmailSchema.safeParse(value);
  if (result.success) {
    if (field.dataset.emailFormatError === "true") {
      field.setCustomValidity("");
      delete field.dataset.emailFormatError;
    }
    return;
  }

  field.setCustomValidity(result.error.issues[0]?.message ?? "Invalid email address");
  field.dataset.emailFormatError = "true";
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/**
 * The state a control is in once it has been checked.
 *
 * A control the user has not filled in yet gets no state at all: an empty
 * optional field is not a success, and marking every blank control green on
 * page load is noise rather than feedback. Choice controls are excluded from
 * the success mark because their `value` is the option's value whether or not
 * it is selected, so it says nothing about whether the group was answered.
 */
function fieldStateFor(control: FormControl): FieldState | null {
  if (!control.checkValidity()) return "invalid";
  if (control instanceof HTMLInputElement) {
    if (control.dataset.personalEmail === "true") return "advisory";
    if (control.type === "radio" || control.type === "checkbox") return null;
  }
  return control.value.trim().length > 0 ? "ok" : null;
}

/**
 * Reports a control's validity through its field.
 *
 * The message and the state move together — the field group is what carries
 * the colour and the mark, so writing the text alone leaves the control looking
 * exactly as it did when it was correct.
 */
function reportField(form: HTMLFormElement, control: FormControl, message: string): void {
  const target = findControlFieldError(control) ?? findFieldErrorTarget(form, control.name);
  if (message.length > 0) {
    setFieldMessage(target, message, "invalid");
    return;
  }
  setFieldMessage(target, "");
  applyFieldState(control.closest(".pk-field"), fieldStateFor(control));
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
      reportField(form, field, field.validationMessage || "Invalid value");
    } else {
      reportField(form, field, "");
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
      reportField(form, target, "");
      return;
    }

    form.classList.add("was-validated");
    reportField(form, target, target.validationMessage || "Invalid value");
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
  if (target.dataset.state !== "error") return;
  target.textContent = "";
  // Mirrors setStatus: the element's own class list says which vocabulary it
  // speaks, so a migrated banner is re-hidden rather than left showing.
  if (target.classList.contains("pk-alert")) {
    target.classList.add("pk-sr-only");
    target.classList.remove("pk-alert--danger", "pk-alert--ok");
  } else {
    target.classList.add("visually-hidden");
    target.classList.remove("alert-danger", "alert-success");
  }
  delete target.dataset.state;
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
