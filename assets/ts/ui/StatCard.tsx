import type { JSX } from "preact";

import "./StatCard.css";

export type StatCardTrend = "up" | "down" | "flat";
/**
 * The state a figure reports, when it reports one. A plain count has no tone;
 * a count that is a standing — seated, waiting, unconfirmed, failed — takes
 * the same six tones the Badge speaks, so a row of figures and a column of
 * badges say "waitlisted" in the same colour.
 */
export type StatCardTone = "accent" | "ok" | "warn" | "danger" | "info" | "neutral";

export interface StatCardProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "value"> {
  label: string;
  value: string;
  note?: string;
  trend?: StatCardTrend;
  /**
   * Makes the whole card a link to the rows behind the number.
   *
   * The link wraps only the label, then stretches over the card, so the card
   * is clickable everywhere while the accessible name stays "Registrations",
   * not "Registrations 412 6 this quarter" — which is what wrapping the whole
   * card in an anchor would announce.
   */
  href?: string;
  /**
   * `compact` is the glance version: the figure leads, the label sits under it
   * in sentence case, and the whole tile centres — three of them across a
   * sidebar panel rather than one across a dashboard.
   *
   * The DOM order stays label-then-value at both densities so the tile is
   * announced the same way however it is drawn; only the visual order flips.
   */
  density?: "default" | "compact";
  /**
   * The state the figure reports. Without one the card is a quiet tile —
   * a hairline, a sunk ground, ink. With one it takes the Badge's treatment
   * for that tone: a soft ground, a dot beside the label, the figure in the
   * tone's ink — so "312 waitlisted" is coloured the way the Waitlisted badge
   * is, and a card that is merely a count is not (#110).
   */
  tone?: StatCardTone;
}

export function StatCard({
  label,
  value,
  note,
  trend,
  href,
  density = "default",
  tone,
  class: className,
  ...rest
}: StatCardProps) {
  const classes = [
    "pk-stat-card",
    tone ? `pk-stat-card--${tone}` : null,
    href ? "pk-stat-card--link" : null,
    density === "compact" ? "pk-stat-card--compact" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const TREND_LABEL: Record<StatCardTrend, string> = {
    up: "trending up",
    down: "trending down",
    flat: "unchanged",
  };

  const noteClasses = ["pk-stat-card__note", trend ? `pk-stat-card__note--${trend}` : null].filter(Boolean).join(" ");

  return (
    <div class={classes} {...rest}>
      <div class="pk-stat-card__label">
        {href ? (
          <a class="pk-stat-card__link" href={href}>
            {label}
          </a>
        ) : (
          label
        )}
      </div>
      <div class="pk-stat-card__value">{value}</div>
      {note && (
        <div class={noteClasses}>
          {/* The direction is carried by colour, which not every reader can
              see, so it is also stated in text. The note itself stays
              readable: "6 this quarter" is the substance, not decoration. */}
          {trend && <span class="pk-stat-card__trend-label">{TREND_LABEL[trend]}, </span>}
          <span>{note}</span>
        </div>
      )}
    </div>
  );
}
