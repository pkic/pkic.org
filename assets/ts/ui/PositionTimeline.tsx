/**
 * The positions held within one tie, oldest at the foot, joined by a rail.
 *
 * The résumé pattern for several roles at one employer: one entry names the
 * organization once, and the roles under it share a vertical line so they read
 * as one career there rather than as unrelated rows. Each position states its
 * title, when it was held, and whatever measures it (an attendance bar).
 */
import type { ComponentChildren } from "preact";

import "./PositionTimeline.css";

export interface Position {
  key: string;
  /** The role and where it was held: "Chair, Post-Quantum Cryptography Working Group". */
  title: ComponentChildren;
  /** When it was held, as one quiet line. */
  when: string;
  /** What measures it, under the dates. */
  children?: ComponentChildren;
  /** The position has ended. */
  past?: boolean;
}

export function PositionTimeline({ label, positions }: { label: string; positions: readonly Position[] }) {
  if (positions.length === 0) return null;
  return (
    <ul class="pk-positions" aria-label={label}>
      {positions.map((position) => (
        <li
          key={position.key}
          class={position.past ? "pk-positions__item pk-positions__item--past" : "pk-positions__item"}
        >
          <div class="pk-positions__title">{position.title}</div>
          <div class="pk-small pk-muted">{position.when}</div>
          {position.children !== undefined && <div class="pk-positions__detail">{position.children}</div>}
        </li>
      ))}
    </ul>
  );
}
