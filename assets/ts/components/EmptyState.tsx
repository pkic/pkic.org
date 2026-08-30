/**
 * A designed empty state: name what is absent, explain it in one line, and —
 * whenever the viewer can act — hand them the action. "No X" with nowhere to
 * go is a dead end, not a state.
 */
import type { ComponentChildren } from "preact";

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
    <div class="pkic-empty-state" role="status">
      <p class="pkic-empty-state-title">{title}</p>
      {body && <p class="pkic-empty-state-body">{body}</p>}
      {action && (
        <button type="button" class="btn btn-sm btn-outline-success" onClick={action.onSelect}>
          {action.label}
        </button>
      )}
      {children}
    </div>
  );
}
