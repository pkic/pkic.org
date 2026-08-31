import type { JSX } from "preact";

import "./StatCard.css";

export type StatCardTrend = "up" | "down" | "flat";

export interface StatCardProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "value"> {
  label: string;
  value: string;
  note?: string;
  trend?: StatCardTrend;
}

export function StatCard({ label, value, note, trend, class: className, ...rest }: StatCardProps) {
  const classes = ["pk-stat-card", className].filter(Boolean).join(" ");

  const TREND_LABEL: Record<StatCardTrend, string> = {
    up: "trending up",
    down: "trending down",
    flat: "unchanged",
  };

  const noteClasses = ["pk-stat-card__note", trend ? `pk-stat-card__note--${trend}` : null].filter(Boolean).join(" ");

  return (
    <div class={classes} {...rest}>
      <div class="pk-stat-card__label">{label}</div>
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
