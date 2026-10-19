import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { ZodError } from "zod";
import { formAnswersContract, type ContractFormField } from "../../../shared/schemas/form-answer-contract";
import type { FormFieldVisibilityContext } from "../../../shared/schemas/form-field-rules";
import { useContractForm } from "../../hooks/useContractForm";
import { readCustomFieldValues } from "../../shared/widgets/custom-fields";

/** The contract field a respondent control answers: `custom.<key>`, `custom.<key>[]`, `custom.<key>.start`. */
function answerFieldOf(name: string): string {
  return name
    .replace(/^custom\./, "")
    .replace(/\[\]$/, "")
    .replace(/\.(start|end)$/, "");
}

/**
 * A respondent form on the answer contract generated from its questions.
 *
 * The respondent controls are the forms system's own widgets, which keep
 * their values in the page; every input, change or click re-reads them, so
 * the body the contract judges is always what the respondent sees. The
 * question rows take their state from `presentationOf`, and a refusal —
 * the contract's, the server's or a live room's — lands on the question it
 * is about through the shared validation map.
 */
export function useFormAnswers(fields: readonly ContractFormField[], context: FormFieldVisibilityContext = {}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const contextKey = JSON.stringify(context);
  // The context is compared by value, the fields by identity.
  const schema = useMemo(() => formAnswersContract(fields, JSON.parse(contextKey)), [fields, contextKey]);
  const contract = useContractForm(schema, answers, { fieldOf: answerFieldOf });

  const sync = useCallback(() => {
    if (formRef.current) setAnswers(readCustomFieldValues(formRef.current));
  }, []);
  // Prefilled answers are written into the controls as they mount.
  useLayoutEffect(sync, [fields, sync]);

  return {
    formRef,
    /** Spread on the form: keeps the body in step with the controls and marks what the respondent touched. */
    handlers: {
      onInput: (event: Event) => {
        sync();
        contract.handlers.onInput(event);
      },
      onChange: (event: Event) => {
        sync();
        contract.handlers.onChange(event);
      },
      onFocusOut: contract.handlers.onFocusOut,
      // A rating or a tag picker changes its value from a button, without an input event.
      onClick: sync,
    },
    presentationOf: contract.of,
    /** Re-reads the controls, after a caller rewrote them (a reset, a prefilled answer). */
    sync,
    submit: contract.submit,
    refuse: contract.refuse,
    /** Marks one question refused, for a refusal that arrives as words rather than a request error. */
    refuseAnswer: (key: string, message: string) =>
      contract.refuse(new ZodError([{ code: "custom", path: [key], message, input: undefined }])),
    reset: contract.reset,
  };
}
