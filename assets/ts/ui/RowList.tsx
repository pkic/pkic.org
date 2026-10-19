/**
 * RowList — a few things in a panel, one per row, with a hairline between them.
 *
 * For a short list that a person manages in place: email addresses, passkeys,
 * a set of preferences. Each row says what it is, may add one quiet line under
 * that, and ends in its actions. A long or sortable list is a table instead.
 *
 * Put it in a `PanelBody flush`: the rows carry their own padding, and the
 * first row has no rule above it, so the panel header is not underlined twice.
 */
import type { ComponentChildren } from "preact";

import "./RowList.css";

export function RowList({ label, children }: { label?: string; children: ComponentChildren }) {
  return (
    <ul class="pk-row-list" aria-label={label}>
      {children}
    </ul>
  );
}

export interface RowListItemProps {
  /** What the row is: a name, an address, or a choice control. */
  children: ComponentChildren;
  /** One quiet line under it. Expected states are plain text here, not a badge. */
  meta?: ComponentChildren;
  /** The row's actions, at its end: normally a `RowActions` menu. */
  end?: ComponentChildren;
}

export function RowListItem({ children, meta, end }: RowListItemProps) {
  return (
    <li class="pk-row-list__item">
      <div class="pk-row-list__text">
        <div class="pk-row-list__main">{children}</div>
        {meta ? <div class="pk-row-list__meta">{meta}</div> : null}
      </div>
      {end ? <div class="pk-row-list__end">{end}</div> : null}
    </li>
  );
}
