/**
 * DescriptionList — term and value pairs as a real `<dl>`.
 *
 * Every record screen in the portal shows the same thing: a stack of labels
 * with values beside them. Each one built it again, and they disagree about
 * the element, the gap, the label colour, and what a missing value looks like
 * — usually nothing at all, which reads as a rendering fault rather than as an
 * absence. This is that block, once.
 *
 * It renders the `pk-datalist` block rather than a new one. The stylesheet for
 * a term/value list already exists in `Content.css` and roughly twenty
 * surfaces write its class names by hand; a second block would be exactly the
 * divergence this component is here to end. The component owns that block now
 * — its density and its empty value live beside it in `DescriptionList.css` —
 * and the hand-written call sites can be moved onto it one at a time without
 * anything having to change underneath them.
 */

import { Fragment } from "preact";
import type { ComponentChildren } from "preact";

import "./Content.css";
import "./DescriptionList.css";

export interface DescriptionListItem {
  /** The label. Unique within one list — it is the row's key. */
  term: string;
  /** Anything renderable. Absent, empty or false renders as an em dash. */
  value?: ComponentChildren;
}

export interface DescriptionListProps {
  items: readonly DescriptionListItem[];
  /**
   * `compact` is the smaller type the sidebars and cards were already reaching
   * for by pairing the list with a `pk-small` class. Naming it here keeps that
   * decision inside the component instead of beside it.
   */
  density?: "default" | "compact";
}

/**
 * `false` counts as absent because `{condition && value}` is how a caller
 * writes a conditional value, and rendering "false" would be worse than
 * rendering nothing. `0` does not — a count of zero is a value.
 */
function isAbsent(value: ComponentChildren): boolean {
  return value === undefined || value === null || value === "" || value === false;
}

export function DescriptionList({ items, density = "default" }: DescriptionListProps) {
  const classes = ["pk-datalist", density === "compact" ? "pk-datalist--compact" : null].filter(Boolean).join(" ");

  return (
    <dl class={classes}>
      {items.map((item) => (
        <Fragment key={item.term}>
          <dt>{item.term}</dt>
          <dd>{isAbsent(item.value) ? <span class="pk-datalist__empty">—</span> : item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
