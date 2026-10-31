import type { ZodType } from "zod";
import { isMembershipApplicationPolicyFieldKey } from "../../shared/schemas/membership-application-form";
import { applyFieldState } from "../ui/field-state";
import { CONTRACT_VALIDATION_ATTRIBUTE, fieldStateFor, type FormControl } from "../shared/form/validation";
import {
  findControlFieldError,
  findFieldErrorTarget,
  normalizeValidation,
  setFieldMessage,
} from "../shared/form/validation-map";

/** The agreement cards report their own state (`membership-legal-validation`). */
function isAgreement(path: string): boolean {
  const key = path.replace(/^answers\./, "");
  return isMembershipApplicationPolicyFieldKey(key);
}

/**
 * Holds the application form to the request contract it submits against.
 *
 * The browser's own constraint messages ("Please fill out this field.") never
 * speak for the form: every field says what the shared schema says, on submit
 * and, once a submission has been refused, as the person corrects it.
 */
export function installJoinApplicationValidation(
  form: HTMLFormElement,
  contract: () => ZodType | null,
  read: () => unknown,
) {
  form.setAttribute(CONTRACT_VALIDATION_ATTRIBUTE, "");
  let attempted = false;
  let shown: HTMLElement[] = [];

  function present(fields: Record<string, string>): void {
    for (const target of shown) setFieldMessage(target, "");
    shown = [];
    for (const [path, message] of Object.entries(fields)) {
      if (isAgreement(path)) continue;
      const target = findFieldErrorTarget(form, path);
      if (!target) continue;
      setFieldMessage(target, message);
      shown.push(target);
    }
  }

  function validate(): boolean {
    const schema = contract();
    if (!schema) return true;
    const result = schema.safeParse(read());
    present(result.success ? {} : normalizeValidation(result.error).fields);
    return result.success;
  }

  /** A control that has been left says what the contract says about it, and shows it is right when it is. */
  function touch(control: FormControl): void {
    const schema = contract();
    const slot = findControlFieldError(control);
    if (!schema || !slot || control.closest("[data-membership-legal-field]")) return;
    const result = schema.safeParse(read());
    const fields = result.success ? {} : normalizeValidation(result.error).fields;
    const message = Object.entries(fields).find(
      ([path]) => !isAgreement(path) && findFieldErrorTarget(form, path) === slot,
    )?.[1];
    setFieldMessage(slot, message ?? "");
    if (!message) applyFieldState(control.closest(".pk-field"), control.value.trim() ? fieldStateFor(control) : null);
    else if (!shown.includes(slot)) shown.push(slot);
  }

  const onControl = (event: Event) => {
    const control = event.target;
    if (
      !(
        control instanceof HTMLInputElement ||
        control instanceof HTMLSelectElement ||
        control instanceof HTMLTextAreaElement
      )
    )
      return;
    if (attempted) validate();
    if (attempted || event.type !== "input") touch(control);
  };
  form.addEventListener("focusout", onControl);
  form.addEventListener("change", onControl);
  form.addEventListener("input", onControl);

  return {
    validate(): boolean {
      attempted = true;
      const valid = validate();
      if (!valid) form.querySelector<HTMLElement>(".pk-field--invalid :is(input, select, textarea)")?.focus();
      return valid;
    },
    /** Shows a refusal from the server where it belongs. */
    refuse(error: unknown): void {
      present(normalizeValidation(error).fields);
    },
  };
}
