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
  /**
   * A figure the chip carries — how many members vouched for a skill, how
   * many rows a value matches. Monospaced, so a row of chips lines its
   * numbers up.
   */
  count?: number;
  /**
   * How much the chip weighs relative to its siblings, 0 to 1. Tints the chip
   * in five steps and, in the top two, takes the accent border — so a shelf of
   * skills reads as a ranking at a glance rather than a uniform row of pills.
   *
   * Quantized deliberately: this is a rough signal, and a continuous fill
   * would need an inline style per chip, which this system avoids for the same
   * reason `Meter` uses a `data-fill` ladder.
   */
  strength?: number;
  children?: ComponentChildren;
}

export function Chip({ pressed, onToggle, onRemove, removeLabel, count, strength, children }: ChipProps) {
  const interactive = typeof onToggle === "function" || pressed !== undefined;
  // 0 is a real weight, so an out-of-range or absent value is the only reason
  // to draw no tint at all.
  const step =
    strength === undefined || Number.isNaN(strength)
      ? undefined
      : String(Math.min(5, Math.max(1, Math.ceil(Math.min(1, Math.max(0, strength)) * 5) || 1)));

  return (
    <span class={["pk-chip", pressed ? "pk-chip--pressed" : null].filter(Boolean).join(" ")} data-strength={step}>
      {interactive ? (
        <button type="button" class="pk-chip__toggle" aria-pressed={pressed} onClick={onToggle}>
          {children}
        </button>
      ) : (
        <span class="pk-chip__toggle pk-chip__toggle--static">{children}</span>
      )}

      {count !== undefined && <span class="pk-chip__count">{count}</span>}

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
