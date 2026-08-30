/**
 * The canonical end-of-row cell: explicit status text plus a ⋯ actions menu.
 * Replaces inline Revoke/Remove/Delete buttons and icon-only toggles so a row
 * states what it is and offers what can be done, in that order. Clicks inside
 * the cell never bubble into a row-click navigation.
 */
import type { ComponentChildren } from "preact";
import { Menu, type MenuAction } from "./Menu";

export function RowActions({
  status,
  actions,
  label = "Row actions",
}: {
  /** Explicit state, already humanized — text or a Badge. */
  status?: ComponentChildren;
  actions: readonly MenuAction[];
  label?: string;
}) {
  return (
    <div
      class="pkic-row-actions"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {status !== undefined && <span class="pkic-row-actions-status">{status}</span>}
      {actions.length > 0 && (
        <Menu label={label} align="end" buttonClass="pkic-row-actions-trigger" buttonContent="⋯" actions={actions} />
      )}
    </div>
  );
}
