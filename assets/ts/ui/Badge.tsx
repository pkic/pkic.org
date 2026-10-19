/**
 * Badge — a status pill.
 *
 * The tone resolves through the shared tone classes (tone.ts) rather than an
 * inline style: the repository forbids `style` attributes (assets/AGENTS.md),
 * and one family keeps a pill and a table row on the same colors.
 */

import type { ComponentChildren } from "preact";
import { formatNumber } from "../../shared/format-number";

import { progressClass, type Tone, type ToneProps } from "./tone";
import "./Badge.css";

export type BadgeTone = Tone;

export interface BadgeProps extends ToneProps {
  /** Accessible name and hover label for a symbolic badge. */
  label?: string;
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
  children,
}: BadgeProps) {
  const classes = [
    "pk-badge",
    `pk-badge--${tone}`,
    progressClass({ progress, progressStyle }),
    dot ? "pk-badge--dot" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span class={classes} role={label ? "img" : undefined} aria-label={label} title={label ?? description}>
      {children}
      {description && !label && <span class="pk-sr-only">: {description}</span>}
    </span>
  );
}

/** A compact, named symbol with an optional count, using the standard badge tones. */
export function IconBadge({
  icon,
  label,
  tone = "neutral",
  count,
}: {
  icon: ComponentChildren;
  label: string;
  tone?: BadgeTone;
  count?: number;
}) {
  return (
    <Badge tone={tone} dot={false} label={label}>
      {icon}
      {count !== undefined && <span aria-hidden="true">{formatNumber(count)}</span>}
    </Badge>
  );
}
