import type { ComponentChildren } from "preact";

/**
 * A settings group folded behind its own summary line.
 *
 * The summary carries the current state so an author can leave it closed and
 * still know what is set — the point of folding is to remove noise, not to
 * hide configuration until they remember to look.
 */
export function FormFold({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ComponentChildren;
}) {
  return (
    <div class="pk-fold">
      <button type="button" class="pk-fold__summary" aria-expanded={open} onClick={onToggle}>
        <span class="pk-strong">{title}</span>
        <span class="pk-cluster">
          <span class="pk-small pk-muted">{summary}</span>
          <span class="pk-small pk-muted" aria-hidden="true">
            {open ? "⌃" : "⌄"}
          </span>
        </span>
      </button>
      {open && <div class="pk-fold__body">{children}</div>}
    </div>
  );
}
