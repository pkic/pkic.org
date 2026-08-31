/**
 * Chip — a removable filter chip.
 *
 * A button that can be toggled and optionally removed.
 */

import type { ComponentChildren, JSX } from "preact";

import "./Chip.css";

export interface ChipProps extends Omit<JSX.HTMLAttributes<HTMLButtonElement>, "size"> {
  pressed?: boolean;
  onRemove?: () => void;
  children?: ComponentChildren;
}

export function Chip({ pressed, onRemove, class: className, children, ...rest }: ChipProps) {
  const classes = ["pk-chip", className].filter(Boolean).join(" ");

  return (
    <button type="button" class={classes} aria-pressed={pressed} {...rest}>
      <span class="pk-chip__label">{children}</span>
      {onRemove && (
        <button
          type="button"
          class="pk-chip__remove"
          aria-label="Remove filter"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        />
      )}
    </button>
  );
}
