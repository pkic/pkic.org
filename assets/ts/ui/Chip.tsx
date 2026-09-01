/**
 * Chip — an applied filter, with an optional way to remove it.
 *
 * The remove control is a SIBLING of the toggle, not a child of it. Nesting a
 * button inside a button is invalid HTML: the inner control is unreachable by
 * keyboard in some browsers, and assistive technology cannot report which of
 * the two it is on. The wrapper is therefore a plain span holding two
 * independent buttons. Caught by the axe suite, not by review.
 *
 * The toggle is only a button when it does something. A chip that merely
 * reports an applied filter renders as text, because a control that does
 * nothing when activated is worse than no control.
 */

import type { ComponentChildren } from "preact";

import "./Chip.css";

export interface ChipProps {
  /** Present when the chip toggles; drives `aria-pressed`. */
  pressed?: boolean;
  onToggle?: () => void;
  /** Present when the chip can be dismissed. Rendered as its own control. */
  onRemove?: () => void;
  /** Names the thing being removed, e.g. "Status: Active". */
  removeLabel?: string;
  children?: ComponentChildren;
}

export function Chip({ pressed, onToggle, onRemove, removeLabel, children }: ChipProps) {
  const interactive = typeof onToggle === "function" || pressed !== undefined;

  return (
    <span class={["pk-chip", pressed ? "pk-chip--pressed" : null].filter(Boolean).join(" ")}>
      {interactive ? (
        <button type="button" class="pk-chip__toggle" aria-pressed={pressed} onClick={onToggle}>
          {children}
        </button>
      ) : (
        <span class="pk-chip__toggle pk-chip__toggle--static">{children}</span>
      )}

      {onRemove && (
        <button
          type="button"
          class="pk-chip__remove"
          aria-label={removeLabel ? `Remove ${removeLabel}` : "Remove filter"}
          onClick={onRemove}
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </span>
  );
}
