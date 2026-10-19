/**
 * The figures above a list — how many rows, and how many of them are what.
 *
 * Three lists drew this line three ways: the proposals catalog as a cluster
 * of `<strong>` counts, the registrations list as a strip of legacy
 * `adm-mini-stat` spans nothing in the design system defines, and the group
 * roster not at all. One component, named as a group so a screen reader lists
 * it as "Registration totals" rather than as loose numbers.
 *
 * Each figure is a small card, the design system's StatCard, in a row that
 * divides the width between them (issue 110). A figure that is a state —
 * registered, waitlisted, needs work — takes that state's tone, the same
 * tone the Badge for it wears in the rows below; a figure that is only a
 * count stays plain. The word beside each number still carries the meaning
 * on its own: the tone repeats it for readers who see it, and says nothing
 * new to those who do not.
 */
import { formatNumber } from "../../shared/format-number";
import { StatCard, type StatCardTone } from "../ui/StatCard";

import "./CollectionTotals.css";

export interface CollectionTotal {
  /** What the figure counts, in lower case: "registered", "no reviews". The card writes it in sentence case. */
  label: string;
  value: number | string;
  /** A qualifier under the figure — "+2 waitlisted". */
  note?: string;
  /** The state the figure reports, when it reports one. */
  tone?: StatCardTone;
}

/**
 * A count is grouped the reader's way ("2,880"). A state that nothing is in
 * — no one waitlisted, nothing needing work — is not a state worth color:
 * the tone is kept for figures above zero.
 */
function figure(item: CollectionTotal): { value: string; tone?: StatCardTone } {
  if (typeof item.value !== "number") return { value: item.value, tone: item.tone };
  return { value: formatNumber(item.value), tone: item.value > 0 ? item.tone : undefined };
}

/** "no reviews" as a label: "No reviews". */
function sentenceCase(label: string): string {
  return label.charAt(0).toLocaleUpperCase() + label.slice(1);
}

export function CollectionTotals({ label, items }: { label: string; items: readonly CollectionTotal[] }) {
  if (items.length === 0) return null;
  return (
    // `role="group"` so the name is actually exposed: `aria-label` on a bare
    // div names nothing. `--fit` keeps a short row of figures on one line
    // rather than leaving the last card alone on a second.
    <div class="pk-stat-row pk-stat-row--fit" role="group" aria-label={label}>
      {items.map((item) => {
        const { value, tone } = figure(item);
        return (
          <StatCard key={item.label} label={sentenceCase(item.label)} value={value} note={item.note} tone={tone} />
        );
      })}
    </div>
  );
}
