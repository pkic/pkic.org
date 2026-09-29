/**
 * The controls that sit inside a Field.
 *
 * Each is a thin pass-through: it applies the shared control class and
 * forwards everything else, so the props a Field hands down — the id, the
 * describedby, the invalid flag — land on the real element without the
 * component needing to know what they mean.
 *
 * They intentionally do not own a label or a message. A control that renders
 * its own label cannot be composed into a layout that needs the label
 * elsewhere, and two labelling paths is how forms end up with orphaned `for`
 * attributes.
 */

import type { JSX } from "preact";

import "./Field.css";

function join(base: string, extra?: string | null): string {
  return extra ? `${base} ${extra}` : base;
}

export type TextInputProps = JSX.InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ class: className, type = "text", ...rest }: TextInputProps) {
  return <input {...rest} type={type} class={join("pk-input", className as string | undefined)} />;
}

export type TextareaProps = JSX.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ class: className, rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea {...rest} rows={rows} class={join("pk-input pk-input--textarea", className as string | undefined)} />
  );
}

export type SelectProps = JSX.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ class: className, children, ...rest }: SelectProps) {
  return (
    <select {...rest} class={join("pk-input pk-input--select", className as string | undefined)}>
      {children}
    </select>
  );
}
