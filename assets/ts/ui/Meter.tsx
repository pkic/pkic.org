/**
 * Meter — a bounded progress or level indicator.
 *
 * The fill width is expressed as a data-fill attribute (not an inline style)
 * with values rounded to 5% increments. CSS rules bind each value to its
 * width, keeping the value out of the inline style while staying accurate
 * enough for a progress bar.
 */

import type { JSX } from "preact";

import "./Meter.css";

export type MeterTone = "accent" | "ok" | "warn" | "danger";

export interface MeterProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "role"> {
  value: number;
  max?: number;
  label: string;
  tone?: MeterTone;
  showValue?: boolean;
}

export function Meter({
  value,
  max = 100,
  label,
  tone = "accent",
  showValue = false,
  class: className,
  ...rest
}: MeterProps) {
  // Clamp value into 0..max
  const clampedValue = Math.max(0, Math.min(value, Math.max(max, 0)));

  // Compute the percentage, rounded to nearest 5% (0, 5, 10, ..., 100)
  const maxSafe = Math.max(max, 1); // Guard against division by zero
  const percentage = (clampedValue / maxSafe) * 100;
  const roundedPercentage = Math.round(percentage / 5) * 5;

  const classes = ["pk-meter", `pk-meter--${tone}`, className].filter(Boolean).join(" ");

  return (
    <div
      {...rest}
      role="meter"
      aria-label={label}
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={Math.max(max, 0)}
      class={classes}
    >
      <div class="pk-meter__track">
        <div class="pk-meter__fill" data-fill={String(roundedPercentage)} />
      </div>
      {showValue && <div class="pk-meter__value">{Math.round(percentage)}%</div>}
    </div>
  );
}
