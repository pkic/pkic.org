/**
 * EmptyState — a designed empty region.
 *
 * Name what is absent, explain it in one line, and — whenever the viewer can
 * act — hand them the action. "No X" with nowhere to go is a dead end, not a
 * state. Vertically stacked and left-aligned to read as informational content
 * rather than a centered ceremonial message.
 *
 * One command, one control: pass `action` only when nothing else on the
 * surface already offers it. A list whose `ApiDataTable` declares a
 * `createAction` puts that command in the toolbar directly above this state,
 * and repeating it here leaves two buttons with one accessible name — which
 * is ambiguous to anyone navigating by name rather than by sight.
 */

import type { ComponentChildren } from "preact";

import { Button } from "./Button";
import "./EmptyState.css";

export interface EmptyStateAction {
  label: string;
  onSelect: () => void;
}

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** The primary way out, when the viewer can act. */
  action?: EmptyStateAction;
  /** A custom affordance (e.g. a link) rendered after the action. */
  children?: ComponentChildren;
}

/**
 * The title is a paragraph, not a heading. An empty state sits inside whatever
 * region is empty — a panel, a tab, a table — so emitting a fixed heading
 * level would insert an arbitrary rung into that page's outline, and emitting
 * an <h2> from inside an <h2>'s own section is how outlines go wrong. The
 * region is already announced by role="status".
 */
export function EmptyState({ title, body, action, children }: EmptyStateProps) {
  return (
    <div role="status" class="pk-empty-state">
      <p class="pk-empty-state__title">{title}</p>
      {body && <p class="pk-empty-state__body">{body}</p>}
      {(action || children) && (
        <div class="pk-empty-state__action">
          {action && (
            <Button size="sm" variant="secondary" onClick={action.onSelect}>
              {action.label}
            </Button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
