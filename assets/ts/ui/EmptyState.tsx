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

export function EmptyState({ title, body, children }: EmptyStateProps) {
  return (
    <div role="status" class="pk-empty-state">
      <h2 class="pk-empty-state__title">{title}</h2>
      {body && <p class="pk-empty-state__body">{body}</p>}
      {children && <div class="pk-empty-state__action">{children}</div>}
    </div>
  );
}
