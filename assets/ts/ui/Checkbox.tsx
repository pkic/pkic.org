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

function Choice({
  type,
  label,
  hint,
  class: className,
  onChange,
  onInput,
  ...rest
}: ChoiceProps & { type: "checkbox" | "radio" }) {
  /*
   * Preact reconciles a controlled input from its `input` event. A controlled
   * checkbox wired only to `onChange` therefore reverts: Preact re-renders
   * from `input` with the old `checked` before `change` fires, so the box
   * flicks back and the caller's state never moves. It looks like a checkbox
   * that simply refuses to tick, and it cannot be ticked by a reader at all.
   *
   * The distinction is Preact's, not the caller's, so the component absorbs
   * it: whichever handler a caller names is invoked from `input`, where
   * `checked` is already the new value. For a checkbox or a radio the two
   * events are the same moment anyway.
   *
   * Twenty-seven call sites pass `onChange`. Fixing it here rather than in
   * each of them is what keeps the twenty-eighth working too.
   */
  const respond: JSX.InputEventHandler<HTMLInputElement> = (event) => {
    onInput?.(event);
    onChange?.(event as unknown as Parameters<NonNullable<typeof onChange>>[0]);
  };

  return (
    <label class={className ? `pk-check ${className}` : "pk-check"}>
      <input {...rest} type={type} class="pk-check__input" onInput={respond} />
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
