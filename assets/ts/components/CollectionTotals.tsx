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
import type { ComponentChildren } from "preact";
import { formatNumber } from "../../shared/format-number";
import { StatCard, type StatCardPart, type StatCardTone } from "../ui/StatCard";

import "./CollectionTotals.css";

export interface CollectionTotal {
  /**
   * What the figure counts, in lower case: "registered", "no reviews". The card
   * writes it in sentence case. A configured name ("Livestream Lounge") is
   * passed as written and keeps its capitals.
   */
  label: string;
  value: number | string;
  /** A qualifier under the figure — "+2 waitlisted". */
  note?: string;
  /** The figure's parts, in place of `note`, each pressable on its own; see StatCard's `breakdown`. */
  breakdown?: readonly StatCardPart[];
  /** The part that matters most, beside the figure; see StatCard's `highlight`. */
  highlight?: StatCardPart;
  /** The state the figure reports, when it reports one. */
  tone?: StatCardTone;
  /** What exactly the figure counts, opened from its label. */
  tooltip?: ComponentChildren;
  /** A decorative mark for what the figure counts. */
  icon?: ComponentChildren;
  /** Opens the rows the figure counts on another page; see StatCard's `href`. Not combined with `onPress`. */
  href?: string;
  /** Narrows the list to the rows the figure counts; see StatCard's `onPress`. */
  onPress?: () => void;
  /** Whether the list is narrowed to this figure's rows now; unset for a card that is an action, not a toggle. */
  pressed?: boolean;
  /** Names the toggle for assistive technology. */
  pressLabel?: string;
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

/** One figure as its card: in a row of totals, or alone in another row of figures. */
export function CollectionTotalCard({ item }: { item: CollectionTotal }) {
  const { value, tone } = figure(item);
  return (
    <StatCard
      label={sentenceCase(item.label)}
      value={value}
      note={item.note}
      breakdown={item.breakdown}
      highlight={item.highlight}
      tone={tone}
      tooltip={item.tooltip}
      icon={item.icon}
      href={item.href}
      onPress={item.onPress}
      pressed={item.pressed}
      pressLabel={item.pressLabel}
    />
  );
}

export function CollectionTotals({ label, items }: { label: string; items: readonly CollectionTotal[] }) {
  if (items.length === 0) return null;
  return (
    // `role="group"` so the name is actually exposed: `aria-label` on a bare
    // div names nothing. `--fit` keeps a short row of figures on one line
    // rather than leaving the last card alone on a second.
    <div class="pk-stat-row pk-stat-row--fit" role="group" aria-label={label}>
      {items.map((item) => (
        <CollectionTotalCard key={item.label} item={item} />
      ))}
    </div>
  );
}
