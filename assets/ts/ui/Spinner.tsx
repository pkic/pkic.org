/**
 * Spinner — a loading indicator.
 *
 * Shows a spinning circle with an accessible label. The label must be in the
 * DOM even when visually hidden, so the control's busy state is announced
 * without removing focus or interrupting the user's interaction.
 */

import "./Spinner.css";

export type SpinnerSize = "sm" | "md";

export interface SpinnerProps {
  label?: string;
  size?: SpinnerSize;
  labelHidden?: boolean;
}

export function Spinner({ label = "Loading…", size = "md", labelHidden = false }: SpinnerProps) {
  const labelClass = ["pk-spinner__label", labelHidden ? "pk-spinner__label--hidden" : null].filter(Boolean).join(" ");

  return (
    <div role="status" class={`pk-spinner pk-spinner--${size}`}>
      <div class="pk-spinner__circle" aria-hidden="true" />
      <span class={labelClass}>{label}</span>
    </div>
  );
}
