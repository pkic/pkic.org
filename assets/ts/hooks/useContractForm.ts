/**
 * A form validated by its shared request contract — the one Zod schema the
 * server route parses — and nothing else.
 *
 * The caller passes the schema and the body it would send. The hook parses
 * that body on every render and submit. A body getter reads uncontrolled or
 * imperatively populated controls fresh at submission. The fields reflect what the contract
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
 *   const checked = form.submit();            // { data } or { formMessage }
 *   if (!checked.data) return setError(checked.formMessage);
 *   try { await patchJson(url, checked.data, responseSchema); }
 *   catch (error) { setError(form.refuse(error)); }
 *
 * A refused submission marks its fields and focuses the first one; the
 * fields say why. `formMessage` is only what no field on the page can say —
 * a rule about the whole body, or a field without a visible control — and is
 * null otherwise, so the form's alert never repeats a field's message.
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

type ControlEvent = { target: EventTarget | null; type?: string };

export interface ContractForm<Output> {
  /** The presentation for the field named `name`. */
  of: (name: string) => FieldPresentation;
  /**
   * The presentation for a field and everything inside it: a set of choices,
   * say, whose own entries may be what the contract refused.
   */
  ofGroup: (name: string) => FieldPresentation;
  /** Visible contract or server errors within an object or collection item. */
  errorsWithin: (name: string) => string[];
  /** Spread on the form (or any ancestor of its controls). */
  handlers: {
    onInput: (event: ControlEvent) => void;
    onChange: (event: ControlEvent) => void;
    onFocusOut: (event: ControlEvent) => void;
  };
  /** Whether the body parses; a submit button may read it. */
  valid: boolean;
  /**
   * Parses the body for sending. On refusal every refused field shows and the
   * first takes focus; `formMessage` carries only a reason no visible field
   * shows, for the form's alert, and is null when the fields say it all.
   */
  submit: () => { data: Output; formMessage: null } | { data: null; formMessage: string | null };
  /** Reads a refused request: marks the fields it names and returns the message for the form. */
  refuse: (error: unknown) => string;
  reset: () => void;
}

interface Touch {
  hasValue: boolean;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isControl(target: EventTarget | null): target is Control {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
  );
}

const CONCEALED = "[hidden],dialog:not([open]),[aria-hidden='true']";

/** The contract fields that have a control on the page, and whether that control is in view. */
function fieldsOnPage(fieldOf: ContractFormOptions["fieldOf"]): Map<string, boolean> {
  const fields = new Map<string, boolean>();
  for (const control of document.querySelectorAll<Control>("input[name],select[name],textarea[name]")) {
    const name = (fieldOf ? fieldOf(control.name, control) : control.name).replace(/\[\]$/, "");
    fields.set(name, fields.get(name) === true || !control.closest(CONCEALED));
  }
  return fields;
}

function related(path: string, field: string): boolean {
  return path === field || path.startsWith(`${field}.`) || field.startsWith(`${path}.`);
}

function hasValue(control: Control): boolean {
  if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
    return control.checked;
  }
  return control.value.trim().length > 0;
}

export interface ContractFormOptions {
  /** Reveal a refused control behind a tab or disclosure before the hook focuses it. */
  revealField?: (name: string) => void;
  /**
   * A composer that sends on content (a chat message, a question): a field
   * the reader left empty says nothing, because empty is the resting state,
   * not a mistake. The contract still refuses the empty body — the submit
   * control reads `valid` and stays disabled — and anything else it refuses,
   * such as a message that is too long, shows as usual.
   */
  quietWhenEmpty?: boolean;
  /**
   * The contract field a control answers, when its `name` is not that field
   * itself — a respondent control is `custom.<key>` or `custom.<key>[]`.
   */
  fieldOf?: (name: string, control: Control) => string;
}

export function useContractForm<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
  options: ContractFormOptions = {},
): ContractForm<z.output<Schema>> {
  const { fieldOf, quietWhenEmpty = false, revealField } = options;
  const [touched, setTouched] = useState<Record<string, Touch>>({});
  const [refused, setRefused] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);
  const [focusAt, setFocusAt] = useState(0);

  const readBody = () => (typeof body === "function" ? body() : body);
  const result = schema.safeParse(readBody());
  const issues: Record<string, string> = result.success ? {} : normalizeValidation(result.error).fields;

  // After a refusal the first refused field takes focus — once its mark is
  // on the page, and only then; retyping must not move the caret.
  useEffect(() => {
    if (focusAt === 0) return;
    Array.from(document.querySelectorAll<HTMLElement>('[aria-invalid="true"]'))
      .find((control) => !control.closest(CONCEALED))
      ?.focus();
  }, [focusAt]);

  const touch = useCallback(
    (event: ControlEvent) => {
      const control = event.target;
      if (!isControl(control) || !control.name) return;
      // Selects and checkboxes commit in change handlers. An input event comes
      // first; rerendering there restores the old controlled value before the
      // change handler can read the user's selection.
      if (
        event.type === "input" &&
        (control instanceof HTMLSelectElement ||
          (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")))
      )
        return;
      const name = fieldOf ? fieldOf(control.name, control) : control.name;
      setTouched((current) => ({ ...current, [name]: { hasValue: hasValue(control) } }));
      // A field being retyped is no longer the field the server refused.
      setRefused((current) => {
        if (!(name in current)) return current;
        const next = { ...current };
        delete next[name];
        return next;
      });
    },
    [fieldOf],
  );

  const of = (name: string): FieldPresentation => {
    // A server refusal shows whether or not the reader touched the field;
    // the contract's own verdict waits until they have.
    const quiet = quietWhenEmpty && !showAll && touched[name]?.hasValue !== true;
    const seen = !quiet && (showAll || name in touched);
    const message = refused[name] ?? (seen ? issues[name] : undefined);
    if (message) return { state: "invalid", message };
    return seen && touched[name]?.hasValue ? { state: "ok" } : {};
  };

  const submit = () => {
    const result = schema.safeParse(readBody());
    if (result.success) return { data: result.data as z.output<Schema>, formMessage: null };
    const first = result.error.issues.find((issue) => issue.path.length > 0);
    const firstPath = first?.path.map(String).join(".");
    if (firstPath !== undefined) revealField?.(firstPath);
    setShowAll(true);
    setFocusAt(Date.now());
    // A field that shows its own reason is not repeated in the form's alert;
    // only a reason with nowhere to show is.
    const onPage = fieldsOnPage(fieldOf);
    const unplaced = result.error.issues.find((issue) => {
      if (issue.path.length === 0) return true;
      const path = issue.path.map(String).join(".");
      return ![...onPage].some(
        ([field, inView]) => related(path, field) && (inView || (revealField !== undefined && path === firstPath)),
      );
    });
    return { data: null, formMessage: unplaced?.message ?? null };
  };

  const refuse = (error: unknown): string => {
    const refusal = normalizeValidation(error);
    if (Object.keys(refusal.fields).length > 0) {
      const names = Object.keys(refusal.fields);
      const first = names.find((name) => !names.some((other) => other.startsWith(`${name}.`)));
      if (first) revealField?.(first);
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

  const errorsWithin = (name: string) =>
    Object.keys({ ...issues, ...refused })
      .filter((key) => key === name || key.startsWith(`${name}.`))
      .flatMap((key) => {
        const presentation = of(key);
        return presentation.message ? [presentation.message] : [];
      });

  const ofGroup = (name: string): FieldPresentation => {
    const [message] = errorsWithin(name);
    return message ? { state: "invalid", message } : of(name);
  };

  return {
    of,
    ofGroup,
    errorsWithin,
    handlers: { onInput: touch, onChange: touch, onFocusOut: touch },
    valid: result.success,
    submit,
    refuse,
    reset,
  };
}
