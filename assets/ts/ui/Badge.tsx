/**
 * Badge — a status pill.
 *
 * The tone resolves through the shared tone classes (tone.ts) rather than an
 * inline style: the repository forbids `style` attributes (assets/AGENTS.md),
 * and one family keeps a pill and a table row on the same colors.
 */

import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { formatNumber } from "../../shared/format-number";

import { progressClass, type Tone, type ToneProps } from "./tone";
import "./Badge.css";

export type BadgeTone = Tone;

export interface BadgeProps extends ToneProps {
  /** Accessible name and hover label for a symbolic badge. */
  label?: string;
  /** Categorical color, independent of workflow status tones. */
  color?: "blue" | "teal" | "purple";
  /** Solid proportion, from zero to one; the remainder uses light stripes. */
  fillFraction?: number;
  /** The dot repeats the tone as a shape, so status is not color alone. */
  dot?: boolean;
  /**
   * What the pill means beyond its words — "handled last on every waiting
   * list" under "Personal email". Shown as the hover tooltip and read after
   * the label, so a short pill does not have to carry a sentence.
   */
  description?: string;
  children?: ComponentChildren;
}

export function Badge({
  tone = "neutral",
  progress,
  progressStyle,
  dot = true,
  label,
  description,
  color,
  fillFraction,
  children,
}: BadgeProps) {
  const stripeId = `badge-stripes-${useId()}`;
  const percent =
    fillFraction !== undefined && Number.isFinite(fillFraction) ? Math.max(0, Math.min(1, fillFraction)) * 100 : 0;
  const classes = [
    "pk-badge",
    `pk-badge--${tone}`,
    progressClass({ progress, progressStyle }),
    dot ? "pk-badge--dot" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      class={classes}
      role={label ? "img" : undefined}
      aria-label={label}
      title={label ?? description}
      data-color={color}
      data-filled={fillFraction !== undefined ? "true" : undefined}
    >
      {fillFraction !== undefined && (
        <svg class="pk-badge__fill" aria-hidden="true" focusable="false">
          <defs>
            <pattern id={stripeId} width="6" height="6" patternUnits="userSpaceOnUse">
              <path class="pk-badge__stripe" d="M-1 1 1-1M0 6 6 0M5 7 7 5" />
            </pattern>
          </defs>
          <rect class="pk-badge__solid" width={`${percent}%`} height="100%" />
          <rect x={`${percent}%`} width={`${100 - percent}%`} height="100%" fill={`url(#${stripeId})`} />
        </svg>
      )}
      {children}
      {description && !label && <span class="pk-sr-only">: {description}</span>}
    </span>
  );
}

/** A compact, named symbol with an optional count and proportional fill. */
export function IconBadge({
  icon,
  label,
  tone = "neutral",
  count,
  color,
  fillFraction,
}: {
  icon: ComponentChildren;
  label: string;
  tone?: BadgeTone;
  count?: number;
  color?: BadgeProps["color"];
  fillFraction?: number;
}) {
  return (
    <Badge tone={tone} dot={false} label={label} color={color} fillFraction={fillFraction}>
      {icon}
      {count !== undefined && <span aria-hidden="true">{formatNumber(count)}</span>}
    </Badge>
  );
}
