/**
 * AttentionList — what still needs doing, as a short checklist.
 *
 * A normal state is said in plain text; only something an organizer has to
 * act on, or something exceptional, earns a tone. Those items are listed here
 * one per line, each with a small warning mark before its words, instead of a
 * row of pills. The mark repeats the words' meaning as a shape and color;
 * the words alone carry it, so nothing is said by color only.
 *
 * Nothing to do renders nothing: an empty checklist is not a state to show.
 */
import type { ComponentChildren } from "preact";

import "./AttentionList.css";

export interface AttentionItem {
  /** Stable key; the words may change with the record. */
  key: string;
  children: ComponentChildren;
}

export function AttentionList({ items, label }: { items: readonly AttentionItem[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <ul class="pk-attention-list" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} class="pk-attention-list__item">
          {item.children}
        </li>
      ))}
    </ul>
  );
}

/** One attention item inline, for a fact that is exceptional beside plain ones. */
export function AttentionMark({ children }: { children: ComponentChildren }) {
  return <span class="pk-attention-mark">{children}</span>;
}
