import { render } from "preact";
import { formAnswersContract } from "../../shared/schemas/form-answer-contract";
import { isMembershipApplicationPolicyFieldKey } from "../../shared/schemas/membership-application-form";
import type { FormFieldDefinition } from "../../shared/schemas/forms";
import { FieldStatus } from "../ui/FieldStatus";
import { applyFieldState, type FieldState } from "../ui/field-state";
import { CONTRACT_VALIDATION_ATTRIBUTE } from "../shared/form/validation";
import { findFieldErrorTarget, normalizeValidation, setFieldMessage } from "../shared/form/validation-map";
import { readCustomFieldValues } from "../shared/widgets/custom-fields";

/** Card feedback uses the same answer contract as membership submission. */
export function installMembershipLegalValidation(form: HTMLFormElement, fields: FormFieldDefinition[]) {
  const legalFields = fields.filter((field) => isMembershipApplicationPolicyFieldKey(field.key));
  const contract = formAnswersContract(legalFields);
  const entries = new Map(
    Array.from(form.querySelectorAll<HTMLElement>("[data-membership-legal-field]"))
      .filter((entry) => !entry.hidden)
      .map((entry) => [entry.dataset.membershipLegalField!, entry]),
  );
  const states = new Map<string, { state: FieldState; message: string }>();

  function present(key: string, state: FieldState, message = "") {
    const entry = entries.get(key);
    if (!entry) return;
    states.set(key, { state, message });
    const target = findFieldErrorTarget(form, key);
    setFieldMessage(target, message, state);
    applyFieldState(target?.closest(".pk-field") ?? null, state);
    const input = entry.querySelector<HTMLInputElement>("[data-membership-legal-input]");
    if (state === "invalid") input?.setAttribute("aria-invalid", "true");
    else input?.removeAttribute("aria-invalid");
    const status = entry.querySelector<HTMLElement>("[data-membership-legal-status]");
    if (status)
      render(
        <FieldStatus
          id={`membership-legal-status-${key}`}
          state={state}
          message={state === "ok" ? "Agreed" : "Agree to continue"}
        />,
        status,
      );
  }

  function validate(keys = [...entries.keys()]): boolean {
    const result = contract.safeParse(readCustomFieldValues(form));
    const errors = result.success ? {} : normalizeValidation(result.error).fields;
    for (const key of keys) present(key, errors[key] ? "invalid" : "ok", errors[key] ?? "");
    return result.success;
  }

  const change = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.matches("[data-membership-legal-input]")) return;
    const key = input.closest<HTMLElement>("[data-membership-legal-field]")?.dataset.membershipLegalField;
    if (key) validate([key]);
  };
  for (const entry of entries.values()) entry.setAttribute(CONTRACT_VALIDATION_ATTRIBUTE, "");
  form.addEventListener("input", change);
  form.addEventListener("change", change);

  return {
    validate: () => validate(),
    refuse(error: unknown) {
      const errors = normalizeValidation(error).fields;
      for (const key of entries.keys()) {
        const message = errors[`answers.${key}`] ?? errors[key];
        const previous = states.get(key);
        if (message) present(key, "invalid", message);
        else if (previous) present(key, previous.state, previous.message);
      }
    },
    dispose() {
      form.removeEventListener("input", change);
      form.removeEventListener("change", change);
      for (const entry of entries.values()) entry.removeAttribute(CONTRACT_VALIDATION_ATTRIBUTE);
    },
  };
}
