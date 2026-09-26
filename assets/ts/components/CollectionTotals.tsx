/**
 * The figures above a list — how many rows, and how many of them are what.
 *
 * Three lists drew this line three ways: the proposals catalogue as a cluster
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
import { StatCard, type StatCardTone } from "../ui/StatCard";

export interface CollectionTotal {
  /** What the figure counts, in lower case: "registered", "no reviews". */
  label: string;
  value: number | string;
  /** A qualifier under the figure — "+2 waitlisted". */
  note?: string;
  /** The state the figure reports, when it reports one. */
  tone?: StatCardTone;
}

export function CollectionTotals({ label, items }: { label: string; items: readonly CollectionTotal[] }) {
  if (items.length === 0) return null;
  return (
    // `role="group"` so the name is actually exposed: `aria-label` on a bare
    // div names nothing.
    <div class="pk-stat-row" role="group" aria-label={label}>
      {items.map((item) => (
        <StatCard key={item.label} label={item.label} value={String(item.value)} note={item.note} tone={item.tone} />
      ))}
    </div>
  );
}
