/**
 * BulkBar — the strip that appears when rows are selected.
 *
 * Announces the selection count for assistive technology via role="status",
 * and provides a clear action and bulk operation controls.
 */

import type { ComponentChildren, JSX } from "preact";

import { Button } from "./Button";
import "./BulkBar.css";

export interface BulkBarProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "role"> {
  /** Number of currently selected rows. */
  count: number;
  /** Total number of rows available. */
  total: number;
  /** Callback fired when the user clears the selection. */
  onClear: () => void;
  /** Bulk action controls. */
  children?: ComponentChildren;
}

export function BulkBar({ count, total, onClear, class: className, children, ...rest }: BulkBarProps) {
  if (count === 0) return null;

  const classes = ["pk-bulk-bar", className].filter(Boolean).join(" ");

  return (
    <div class={classes} role="status" {...rest}>
      <div class="pk-bulk-bar__count">
        {count} of {total} selected
      </div>

      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear selection
      </Button>

      {children && <div class="pk-bulk-bar__actions">{children}</div>}
    </div>
  );
}
