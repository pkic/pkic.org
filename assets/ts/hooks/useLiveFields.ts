/**
 * Live field validation for a Preact form — the same model the server-rendered
 * forms run through `installLiveValidation`: a control is checked as it is
 * typed in, changed or left, its own constraints (`type`, `required`,
 * `maxlength`) and the shared-contract rules decide, and the field it sits in
 * shows the state — ok, or invalid with the reason.
 *
 * Usage:
 *   const live = useLiveFields();
 *   <div onInput={live.check} onChange={live.check} onFocusOut={live.check}>
 *     <Field label="Website" {...live.of("website")}>
 *       {(control) => <TextInput {...control} name="website" type="url" … />}
 *     </Field>
 *   </div>
 *   // On a refused submission: live.report(normalizeValidation(error).fields)
 *
 * Controls are keyed by their `name`; one without a name is not checked.
 */
import { useCallback, useState } from "preact/hooks";
import { applyControlValidity, fieldStateFor } from "../shared/form/validation";
import type { FieldState } from "../ui/field-state";

export interface LiveField {
  state?: FieldState;
  message?: string;
}

export interface LiveFields {
  /** The state a Field spreads: `state` and, when invalid, its `message`. */
  of: (name: string) => LiveField;
  /** Checks the control the event came from. */
  check: (event: Event) => void;
  /** Marks fields refused by the shared contract or the server, by name. */
  report: (fields: Record<string, string>) => void;
  reset: () => void;
}

function isFormControl(
  target: EventTarget | null,
): target is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement
  );
}

export function useLiveFields(): LiveFields {
  const [fields, setFields] = useState<Record<string, LiveField>>({});

  const check = useCallback((event: Event) => {
    const control = event.target;
    if (!isFormControl(control) || !control.name) return;
    applyControlValidity(control);
    const state = fieldStateFor(control);
    const next: LiveField =
      state === "invalid" ? { state, message: control.validationMessage || "Invalid value" } : state ? { state } : {};
    setFields((current) => ({ ...current, [control.name]: next }));
  }, []);

  const report = useCallback((refused: Record<string, string>) => {
    setFields((current) => {
      const next = { ...current };
      for (const [name, message] of Object.entries(refused)) next[name] = { state: "invalid", message };
      return next;
    });
  }, []);

  const reset = useCallback(() => setFields({}), []);

  return { of: (name) => fields[name] ?? {}, check, report, reset };
}
