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

import "./Field.css";

export type FieldState = "ok" | "advisory" | "invalid";

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

const STATE_ICON: Record<FieldState, string> = {
  // Tick, triangle, cross — drawn as paths so they take currentColor and scale
  // with the control rather than arriving as three more network requests.
  ok: "M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-4.03-2.97a.75.75 0 0 0-1.08.02L7.48 9.4 5.7 7.6a.75.75 0 1 0-1.06 1.06l2.35 2.35a.75.75 0 0 0 1.08-.02l3.92-4.9a.75.75 0 0 0-.02-1.06",
  advisory:
    "M8.98 1.57a1.13 1.13 0 0 0-1.96 0L.16 13.23c-.45.78.1 1.77.99 1.77h13.71c.89 0 1.44-.99.98-1.77zM8 5c.54 0 .95.46.9 1l-.35 3.5a.55.55 0 0 1-1.1 0L7.1 6A.9.9 0 0 1 8 5m0 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2",
  invalid:
    "M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.35 4.29a.75.75 0 0 0-1.06 1.06L6.94 8l-2.65 2.65a.75.75 0 1 0 1.06 1.06L8 9.06l2.65 2.65a.75.75 0 0 0 1.06-1.06L9.06 8l2.65-2.65a.75.75 0 0 0-1.06-1.06L8 6.94z",
};

export function StateIcon({ state, class: className }: { state: FieldState; class?: string }) {
  return (
    <svg class={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d={STATE_ICON[state]} />
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
