/**
 * Checkbox and Radio — the design system's choice controls.
 *
 * The native element stays, so the semantics and keyboard behaviour stay;
 * the drawing is the system's (`pk-check` in Field.css), so the control
 * matches the accent instead of the operating system's. The label wraps the
 * control, so the whole line is the hit target and no `for` can go stale.
 *
 * Inside a `Field` a choice control takes the same `control` props a text
 * control does; on its own it is complete, label included.
 */
import type { ComponentChildren, JSX } from "preact";

import "./Field.css";

type ChoiceInputProps = Omit<JSX.InputHTMLAttributes<HTMLInputElement>, "type" | "class" | "label">;

export interface ChoiceProps extends ChoiceInputProps {
  /** The line the control is read as. */
  label: ComponentChildren;
  /** A second, quieter line under the label. */
  hint?: ComponentChildren;
  /** Extra classes for the wrapping label, e.g. a layout utility. */
  class?: string;
}

function Choice({ type, label, hint, class: className, ...rest }: ChoiceProps & { type: "checkbox" | "radio" }) {
  return (
    <label class={className ? `pk-check ${className}` : "pk-check"}>
      <input {...rest} type={type} class="pk-check__input" />
      <span>
        <span class="pk-check__label">{label}</span>
        {hint && <span class="pk-check__hint">{hint}</span>}
      </span>
    </label>
  );
}

export function Checkbox(props: ChoiceProps) {
  return <Choice {...props} type="checkbox" />;
}

export function Radio(props: ChoiceProps) {
  return <Choice {...props} type="radio" />;
}
