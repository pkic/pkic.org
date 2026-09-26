/**
 * One tie between two subjects, stated from whichever side you are reading.
 *
 * On a person's record it is an organization they represent; on an
 * organization's record it is a person who represents it. The shape is the
 * same in both directions — mark, name, the terms of the tie, and what the
 * subject does there — so the two records share this rather than each growing
 * its own row that drifts from the other.
 *
 * `past` is the whole treatment for a tie that has ended: dimmed and
 * desaturated, with the dates left to say when. A separate "former" heading
 * would split one list into two and lose the ordering that makes a history
 * readable.
 */
import type { ComponentChildren } from "preact";

import "./AffiliationRow.css";

export interface AffiliationRowProps {
  /** The other subject's mark: a logo tile, an `Avatar`, an icon. */
  media?: ComponentChildren;
  /** The other subject's name. */
  title: string;
  /** Where the name should lead — the other subject's own record. */
  href?: string;
  /**
   * A standing within the tie, shown beside the name: "Primary contact",
   * "Billing owner". Not the role — that belongs in `terms`.
   */
  marker?: ComponentChildren;
  /**
   * The terms of the tie, in one quiet line: role, dates, the address it runs
   * through. Entries are separate so the separators stay presentational.
   */
  terms?: readonly ComponentChildren[];
  /** What the subject does on the other side of the tie. */
  children?: ComponentChildren;
  /**
   * What can be done about the tie: a menu, at the end of the row.
   *
   * A menu rather than a slot for buttons, and its own track rather than a
   * place in the detail column, because a list of ties is read down the names
   * — controls beside each one turn it into a list of controls.
   */
  actions?: ComponentChildren;
  /**
   * Whatever the actions open, under what the tie says.
   *
   * Inside the detail column, so an editor stays within its own tie rather
   * than between two of them, where the rule that separates rows would land on
   * the wrong side of it.
   */
  footer?: ComponentChildren;
  /** The tie has ended. */
  past?: boolean;
}

export function AffiliationRow({
  media,
  title,
  href,
  marker,
  terms,
  children,
  actions,
  footer,
  past = false,
}: AffiliationRowProps) {
  return (
    <article class={past ? "pk-affiliation pk-affiliation--past" : "pk-affiliation"}>
      {media !== undefined && <div class="pk-affiliation__media">{media}</div>}

      <div class="pk-affiliation__detail">
        <div class="pk-affiliation__name">
          {href ? (
            <a class="pk-strong" href={href}>
              {title}
            </a>
          ) : (
            <span class="pk-strong">{title}</span>
          )}
          {marker !== undefined && <span class="pk-small pk-muted">{marker}</span>}
        </div>

        {terms !== undefined && terms.length > 0 && (
          <ul class="pk-affiliation__terms pk-small pk-muted">
            {terms.map((term, index) => (
              // A fixed set of statements per tie; index is the only identity
              // arbitrary content offers.
              <li key={index}>{term}</li>
            ))}
          </ul>
        )}

        {children !== undefined && <p class="pk-affiliation__summary">{children}</p>}

        {footer !== undefined && <div class="pk-affiliation__footer">{footer}</div>}
      </div>

      {actions !== undefined && <div class="pk-affiliation__actions">{actions}</div>}
    </article>
  );
}
