/**
 * Field — label, control, and validation message as one unit.
 *
 * The validation model has three states, matching what the event flows already
 * ship, and the distinction between them is behavioural rather than cosmetic:
 *
 *   ok       the value was checked and is good
 *   advisory something worth knowing that does NOT block submission — a
 *            personal email domain, say. It must not set `aria-invalid`, or a
 *            screen reader announces a blocking error for a form that will
 *            submit perfectly well.
 *   invalid  submission is blocked
 *
 * Each state carries a mark as well as a colour. Roughly one man in twelve
 * cannot separate the green and red by hue, so colour alone is not a status.
 */

import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";

import { FIELD_STATE_ICON, type FieldState } from "./field-state";
import "./Field.css";

export type { FieldState };

export interface FieldProps {
  label: string;
  /** Marks the control required and annotates the label. */
  required?: boolean;
  /** Persistent guidance. Replaced by the message when a state is set. */
  help?: string;
  state?: FieldState;
  /** The message for `state`. Required whenever a state is set. */
  message?: string;
  /** Receives the ids and ARIA the control must carry. */
  children: (control: FieldControlProps) => ComponentChildren;
}

/** What a control inside a Field must spread onto its input element. */
export interface FieldControlProps {
  id: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: "true";
}

export function StateIcon({ state, class: className }: { state: FieldState; class?: string }) {
  return (
    <svg class={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={FIELD_STATE_ICON[state]} />
    </svg>
  );
}

export function Field({ label, required = false, help, state, message, children }: FieldProps) {
  const id = useId();
  const controlId = `${id}-control`;
  const messageId = `${id}-message`;
  const helpId = `${id}-help`;

  const showMessage = Boolean(state && message);
  const describedBy = showMessage ? messageId : help ? helpId : undefined;

  return (
    <div class={["pk-field", state ? `pk-field--${state}` : null].filter(Boolean).join(" ")}>
      <label class="pk-field__label" for={controlId}>
        {label}
        {required && (
          <span class="pk-field__required">
            <span aria-hidden="true">*</span>
            <span class="pk-field__sr">(required)</span>
          </span>
        )}
      </label>

      <div class="pk-field__control">
        {children({
          id: controlId,
          required: required || undefined,
          "aria-describedby": describedBy,
          // Only a blocking state is invalid. An advisory is not an error.
          "aria-invalid": state === "invalid" ? "true" : undefined,
        })}
        {state && <StateIcon state={state} class="pk-field__state" />}
      </div>

      {showMessage && (
        <p
          class="pk-field__message"
          id={messageId}
          // An advisory appears without the user having submitted anything, so
          // it is announced politely; a blocking error interrupts.
          role={state === "invalid" ? "alert" : "status"}
        >
          {state && <StateIcon state={state} class="pk-field__message-icon" />}
          {message}
        </p>
      )}

      {!showMessage && help && (
        <p class="pk-field__help" id={helpId}>
          {help}
        </p>
      )}
    </div>
  );
}
