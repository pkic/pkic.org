/**
 * A form validated by its shared request contract — the one Zod schema the
 * server route parses — and nothing else.
 *
 * The caller passes the schema and the body it would send. The hook parses
 * that body on every render, so the fields always reflect what the contract
 * would say; a field only *shows* a state once the reader has touched it
 * (input, change or leaving it) or once a submission was refused, so a form
 * does not open covered in red. Messages come from the contract through the
 * shared validation map, and a server refusal is read through the same map,
 * so a field is told the same thing whichever side refused it.
 *
 * Usage:
 *   const form = useContractForm(userUpdateSchema, payloadFromDraft(draft));
 *   <form noValidate {...form.handlers} onSubmit={…}>
 *     <Field label="Website" {...form.of("website")}>
 *       {(control) => <TextInput {...control} name="website" type="url" … />}
 *     </Field>
 *   // On save:
 *   const checked = form.submit();            // { data } or { message }
 *   if (!checked.data) return setError(checked.message);
 *   try { await patchJson(url, checked.data, responseSchema); }
 *   catch (error) { setError(form.refuse(error)); }
 *
 * Controls are keyed by `name`, which must match the contract's field.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import { normalizeValidation } from "../shared/form/validation-map";
import type { FieldState } from "../ui/field-state";

/** What a Field spreads: its state and, when invalid, the reason. */
export interface FieldPresentation {
  state?: FieldState;
  message?: string;
}

type ControlEvent = { target: EventTarget | null };

export interface ContractForm<Output> {
  /** The presentation for the field named `name`. */
  of: (name: string) => FieldPresentation;
  /** Spread on the form (or any ancestor of its controls). */
  handlers: {
    onInput: (event: ControlEvent) => void;
    onChange: (event: ControlEvent) => void;
    onFocusOut: (event: ControlEvent) => void;
  };
  /** Whether the body parses; a submit button may read it. */
  valid: boolean;
  /** Parses the body for sending; on refusal, every refused field shows and the first takes focus. */
  submit: () => { data: Output; message: null } | { data: null; message: string };
  /** Reads a refused request: marks the fields it names and returns the message for the form. */
  refuse: (error: unknown) => string;
  reset: () => void;
}

interface Touch {
  hasValue: boolean;
}

function isControl(target: EventTarget | null): target is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
  );
}

function hasValue(control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
  if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
    return control.checked;
  }
  return control.value.trim().length > 0;
}

export function useContractForm<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
): ContractForm<z.output<Schema>> {
  const [touched, setTouched] = useState<Record<string, Touch>>({});
  const [refused, setRefused] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [focusAt, setFocusAt] = useState(0);

  const result = schema.safeParse(body);
  const issues: Record<string, string> = result.success ? {} : normalizeValidation(result.error).fields;

  // After a refusal the first refused field takes focus — once its mark is
  // on the page, and only then; retyping must not move the caret.
  useEffect(() => {
    if (focusAt === 0) return;
    document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusAt]);

  const touch = useCallback((event: ControlEvent) => {
    const control = event.target;
    if (!isControl(control) || !control.name) return;
    const name = control.name;
    setTouched((current) => ({ ...current, [name]: { hasValue: hasValue(control) } }));
    // A field being retyped is no longer the field the server refused.
    setRefused((current) => {
      if (!(name in current)) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
  }, []);

  const of = (name: string): FieldPresentation => {
    // A server refusal shows whether or not the reader touched the field;
    // the contract's own verdict waits until they have.
    const seen = showAll || name in touched;
    const message = refused[name] ?? (seen ? issues[name] : undefined);
    if (message) return { state: "invalid", message };
    return seen && touched[name]?.hasValue ? { state: "ok" } : {};
  };

  const submit = () => {
    if (result.success) return { data: result.data as z.output<Schema>, message: null };
    setShowAll(true);
    setFocusAt(Date.now());
    return { data: null, message: normalizeValidation(result.error).globalMessage };
  };

  const refuse = (error: unknown): string => {
    const refusal = normalizeValidation(error);
    if (Object.keys(refusal.fields).length > 0) {
      setRefused(refusal.fields);
      setFocusAt(Date.now());
    }
    return refusal.globalMessage;
  };

  const reset = useCallback(() => {
    setTouched({});
    setRefused({});
    setShowAll(false);
  }, []);

  return {
    of,
    handlers: { onInput: touch, onChange: touch, onFocusOut: touch },
    valid: result.success,
    submit,
    refuse,
    reset,
  };
}
