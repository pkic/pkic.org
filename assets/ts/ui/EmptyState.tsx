/**
 * EmptyState — a designed empty region.
 *
 * Shows a title, optional body text, and action button when a list, search,
 * or collection is empty. Vertically stacked and left-aligned to read as
 * informational content rather than a centered ceremonial message.
 */

import type { ComponentChildren } from "preact";

import "./EmptyState.css";

export interface EmptyStateProps {
  title: string;
  body?: string;
  children?: ComponentChildren;
}

/**
 * The title is a paragraph, not a heading. An empty state sits inside whatever
 * region is empty — a panel, a tab, a table — so emitting a fixed heading
 * level would insert an arbitrary rung into that page's outline, and emitting
 * an <h2> from inside an <h2>'s own section is how outlines go wrong. The
 * region is already announced by role="status".
 */
export function EmptyState({ title, body, children }: EmptyStateProps) {
  return (
    <div role="status" class="pk-empty-state">
      <p class="pk-empty-state__title">{title}</p>
      {body && <p class="pk-empty-state__body">{body}</p>}
      {children && <div class="pk-empty-state__action">{children}</div>}
    </div>
  );
}
