/**
 * A designed empty state: name what is absent, explain it in one line, and —
 * whenever the viewer can act — hand them the action. "No X" with nowhere to
 * go is a dead end, not a state.
 *
 * The `action` shorthand exists because seventeen surfaces pass one; the
 * design system's EmptyState takes children, so the button it renders is the
 * design system's Button rather than a Bootstrap one.
 */
import type { ComponentChildren } from "preact";

import { Button } from "../ui/Button";
import { EmptyState as SystemEmptyState } from "../ui/EmptyState";

export function EmptyState({
  title,
  body,
  action,
  children,
}: {
  title: string;
  body?: string;
  /** The primary way out, when the viewer can act. */
  action?: { label: string; onSelect: () => void };
  /** Optional custom affordance (e.g. a Link) rendered after body. */
  children?: ComponentChildren;
}) {
  return (
    <div class="pk">
      <SystemEmptyState title={title} body={body}>
        {action && (
          <Button size="sm" variant="secondary" onClick={action.onSelect}>
            {action.label}
          </Button>
        )}
        {children}
      </SystemEmptyState>
    </div>
  );
}
