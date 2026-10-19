/**
 * CollectionCard — one record in a grid of cards: an event, a group.
 *
 * Every card in a collection has the same anatomy, so a reader scanning a
 * grid finds the same thing in the same place on each one:
 *
 *   media     a fixed-height band: the record's own image, or a generated
 *             cover (the record's ground, the cover circles, its glyph or
 *             monogram) when it has none. The band never shrinks, so a card
 *             without an image is not a shorter card.
 *   kind      what sort of record this is — "Conference", "Working group" —
 *             as a quiet kicker over the title rather than a suffix in it.
 *   title     the card's one link, stretched over the whole card.
 *   meta      one line of context: where an event is, what a group is part of.
 *   summary   optional, two lines at most.
 *   status    where the viewer stands, as one line of plain text; only a
 *             state that needs attention is drawn as a badge.
 *   footer    the record's key fact at the start, its actions menu at the end.
 *
 * The cover's ground is the caller's: a modifier class sets
 * `--pk-collection-cover`, so a collection keeps its own palette without the
 * card knowing every group's colors.
 */

import type { ComponentChildren } from "preact";
import { Badge } from "./Badge";
import type { HeadingTag } from "./HeadingOutline";

import "./CollectionCard.css";

export interface CollectionCardCover {
  /** Modifier class that sets `--pk-collection-cover` for this record. */
  class?: string;
  /** A decorative mark drawn on the generated cover: an icon, or a short monogram. */
  glyph?: ComponentChildren;
}

/**
 * One fact about where the viewer stands.
 *
 * An expected state — registered, speaking, joined — has no tone and reads as
 * plain text: "You're registered · Speaker". A tone is for a state that
 * changes what the reader does next (waitlisted, waiting on them, declined,
 * cancelled), and never green: green on every card says nothing.
 */
export interface CollectionStatus {
  label: string;
  tone?: "info" | "warn" | "danger" | "neutral";
  /** Shown on hover and said after the label, for a fact that summarizes a list. */
  description?: string;
}

export interface CollectionCardProps {
  title: string;
  href: string;
  /** The record's kind, shown as the kicker over the title. */
  kind?: string;
  heading?: HeadingTag;
  /** The record's own image. Without one, the generated cover is drawn. */
  imageSrc?: string;
  cover?: CollectionCardCover;
  meta?: ComponentChildren;
  summary?: string;
  /** The viewer's standing. */
  status?: readonly CollectionStatus[];
  /** Names the status line for assistive technology. */
  statusLabel?: string;
  /** The record's key fact, at the start of the footer. */
  fact?: ComponentChildren;
  /** The record's actions menu, at the end of the footer. */
  actions?: ComponentChildren;
}

export function CollectionCard({
  title,
  href,
  kind,
  heading: Heading = "h3",
  imageSrc,
  cover,
  meta,
  summary,
  status,
  statusLabel = "Your status",
  fact,
  actions,
}: CollectionCardProps) {
  return (
    <article class={`pk-collection-card${cover?.class ? ` ${cover.class}` : ""}`}>
      <div class={`pk-collection-card__media${imageSrc ? "" : " pk-collection-card__media--cover"}`}>
        {imageSrc ? (
          <img src={imageSrc} alt="" loading="lazy" decoding="async" width="600" height="240" />
        ) : cover?.glyph ? (
          <span class="pk-collection-card__glyph" aria-hidden="true">
            {cover.glyph}
          </span>
        ) : null}
      </div>
      <div class="pk-collection-card__body">
        {kind && <p class="pk-collection-card__kind">{kind}</p>}
        <Heading class="pk-collection-card__title">
          <a href={href}>{title}</a>
        </Heading>
        {meta && <p class="pk-collection-card__meta">{meta}</p>}
        {summary && <p class="pk-collection-card__summary">{summary}</p>}
        {status && status.length > 0 && (
          <div class="pk-collection-card__status" role="group" aria-label={statusLabel}>
            <CollectionStatusLine items={status} />
          </div>
        )}
      </div>
      {(fact || actions) && (
        <div class="pk-collection-card__footer" data-density="compact">
          <span class="pk-collection-card__fact">{fact}</span>
          {actions && <span class="pk-collection-card__actions">{actions}</span>}
        </div>
      )}
    </article>
  );
}

/**
 * The viewer's standing as one line: the expected facts as plain text joined
 * by a quiet separator, then any state that needs attention as a toned badge.
 * The same line in a card and in a list's status column.
 */
export function CollectionStatusLine({ items }: { items: readonly CollectionStatus[] }) {
  if (items.length === 0) return null;
  const plain = items.filter((item) => !item.tone);
  const flagged = items.filter((item) => item.tone);
  return (
    <span class="pk-collection-status">
      {plain.length > 0 && (
        <span class="pk-collection-status__text">
          {plain.map((item) => (
            <span key={item.label} class="pk-collection-status__fact" title={item.description}>
              {item.label}
              {item.description && <span class="pk-sr-only">: {item.description}</span>}
            </span>
          ))}
        </span>
      )}
      {flagged.map((item) => (
        <Badge key={item.label} tone={item.tone} description={item.description}>
          {item.label}
        </Badge>
      ))}
    </span>
  );
}
