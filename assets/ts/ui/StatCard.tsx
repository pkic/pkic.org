import { Fragment, type ComponentChildren, type JSX } from "preact";
import { Tooltip } from "./Tooltip";

import "./StatCard.css";

export type StatCardTrend = "up" | "down" | "flat";
/**
 * The state a figure reports, when it reports one. A plain count has no tone;
 * a count that is a standing — seated, waiting, unconfirmed, failed — takes
 * the same six tones the Badge speaks, so a row of figures and a column of
 * badges say "waitlisted" in the same color.
 */
export type StatCardTone = "accent" | "ok" | "warn" | "danger" | "info" | "neutral";

/**
 * One figure in the line under the value: "356 waitlisted". With `onPress`
 * it is a toggle of its own, above the card's, that narrows the list to just
 * those rows; `pressed` is whether it does now. With `href` it is a link of
 * its own, above the card's, to the list narrowed to those rows.
 */
export interface StatCardPart {
  text: string;
  href?: string;
  onPress?: () => void;
  pressed?: boolean;
  /** Names the toggle or link for assistive technology: "Show only the 356 waitlisted registrations". */
  pressLabel?: string;
}

export interface StatCardProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "value"> {
  label: string;
  value: string;
  note?: string;
  /**
   * The figure broken down, in place of `note`: its parts in a line under
   * the value, separated by a middle dot, each one pressable on its own.
   */
  breakdown?: readonly StatCardPart[];
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
   * in sentence case, and the whole tile centers — three of them across a
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
   * tone's ink — so "312 waitlisted" is colored the way the Waitlisted badge
   * is, and a card that is merely a count is not (#110).
   */
  tone?: StatCardTone;
  /**
   * What exactly the figure counts, when the label alone cannot say it. The
   * label becomes the trigger of the shared Tooltip, so it opens on hover,
   * focus and tap. Not combined with `href`: the label is then the link.
   */
  tooltip?: ComponentChildren;
  /**
   * A decorative mark for what the figure counts, in the card's top-right
   * corner: the same icon the rows below use, so the figure and its rows are
   * recognizably the same thing. The label still says it in words.
   */
  icon?: ComponentChildren;
  /**
   * Makes the card a toggle that narrows the list below to the rows behind
   * the number. A button covers the card, the way `href` stretches its link,
   * so the card is pressable everywhere while the label's tooltip stays
   * reachable above it. `pressLabel` names the toggle for assistive
   * technology ("Filter the list: In person"); `pressed` is whether the
   * list is narrowed that way now. Without `pressed` the card is a plain
   * action, not a toggle: a failed figure's "Try again". Not combined with
   * `href`.
   */
  onPress?: () => void;
  pressed?: boolean;
  pressLabel?: string;
}

export function StatCard({
  label,
  value,
  note,
  breakdown,
  trend,
  href,
  density = "default",
  tone,
  tooltip,
  icon,
  onPress,
  pressed,
  pressLabel,
  class: className,
  ...rest
}: StatCardProps) {
  const classes = [
    "pk-stat-card",
    tone ? `pk-stat-card--${tone}` : null,
    href ? "pk-stat-card--link" : null,
    density === "compact" ? "pk-stat-card--compact" : null,
    icon ? "pk-stat-card--icon" : null,
    onPress ? "pk-stat-card--pressable" : null,
    onPress && pressed ? "pk-stat-card--pressed" : null,
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
      {icon && (
        <span class="pk-stat-card__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div class="pk-stat-card__label">
        {href ? (
          <a class="pk-stat-card__link" href={href}>
            {label}
          </a>
        ) : tooltip ? (
          <Tooltip label={label} content={tooltip}>
            <span class="pk-stat-card__hint">{label}</span>
          </Tooltip>
        ) : (
          label
        )}
      </div>
      <div class="pk-stat-card__value">{value}</div>
      {note && (
        <div class={noteClasses}>
          {/* The direction is carried by color, which not every reader can
              see, so it is also stated in text. The note itself stays
              readable: "6 this quarter" is the substance, not decoration. */}
          {trend && <span class="pk-stat-card__trend-label">{TREND_LABEL[trend]}, </span>}
          <span>{note}</span>
        </div>
      )}
      {breakdown && breakdown.length > 0 && (
        <div class="pk-stat-card__note">
          {breakdown.map((part, index) => (
            <Fragment key={part.text}>
              {index > 0 && <span aria-hidden="true">{" · "}</span>}
              {part.href ? (
                <a class="pk-stat-card__part" href={part.href} aria-label={part.pressLabel}>
                  {part.text}
                </a>
              ) : part.onPress ? (
                <button
                  type="button"
                  class="pk-stat-card__part"
                  aria-pressed={part.pressed ?? false}
                  aria-label={part.pressLabel}
                  onClick={part.onPress}
                >
                  {part.text}
                </button>
              ) : (
                <span>{part.text}</span>
              )}
            </Fragment>
          ))}
        </div>
      )}
      {onPress && (
        <button type="button" class="pk-stat-card__press" aria-pressed={pressed} onClick={onPress}>
          <span class="pk-sr-only">{pressLabel ?? label}</span>
        </button>
      )}
    </div>
  );
}
