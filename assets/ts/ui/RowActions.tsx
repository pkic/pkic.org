/**
 * RowActions — the end of a table row: what this row IS, then what can be
 * done to it.
 *
 * Rows used to end in a line of inline buttons — Revoke, Remove, Delete — or
 * in an icon-only toggle whose meaning depended on its current state. Both
 * scale badly: the buttons crowd out the row's actual content on a narrow
 * screen, and an icon that means "revoke" when lit and "restore" when dim is
 * a puzzle, not a control. A row states its status in words and collapses its
 * actions into one menu.
 *
 * Clicks and key presses inside the cell do not bubble. A row is often itself
 * clickable, and opening its menu must not also navigate away from it.
 */

import type { ComponentChildren } from "preact";

import { Menu, type MenuItem } from "./Menu";

import "./RowActions.css";

export interface RowActionsProps {
  /** The row's state, already in words — text, or a Badge. */
  status?: ComponentChildren;
  actions: readonly MenuItem[];
  /** Accessible name for the menu, ideally naming the row's subject. */
  label?: string;
}

export function RowActions({ status, actions, label = "Row actions" }: RowActionsProps) {
  return (
    <div
      class="pk-row-actions"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {status !== undefined && <span class="pk-row-actions__status">{status}</span>}
      {/* End-aligned: a start-aligned popup on the last column hangs off the
          table's right edge before the viewport clamp ever gets a say. */}
      {actions.length > 0 && <Menu label={label} items={actions} align="end" />}
    </div>
  );
}
