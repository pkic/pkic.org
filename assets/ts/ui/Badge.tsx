/**
 * Badge — a status pill.
 *
 * The tone resolves through a modifier class rather than an inline style: the
 * repository forbids `style` attributes (assets/AGENTS.md), and a class also
 * keeps the six tone definitions in the stylesheet where the rest of the
 * component's appearance lives.
 */

import type { ComponentChildren } from "preact";

import "./Badge.css";

export type BadgeTone = "ok" | "warn" | "danger" | "info" | "neutral" | "accent";

export interface BadgeProps {
  tone?: BadgeTone;
  /** Accessible name and hover label for a symbolic badge. */
  label?: string;
  /** The dot repeats the tone as a shape, so status is not colour alone. */
  dot?: boolean;
  children?: ComponentChildren;
}

export function Badge({ tone = "neutral", dot = true, label, children }: BadgeProps) {
  const classes = ["pk-badge", `pk-badge--${tone}`, dot ? "pk-badge--dot" : null].filter(Boolean).join(" ");

  return (
    <span class={classes} role={label ? "img" : undefined} aria-label={label} title={label}>
      {children}
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
      {count !== undefined && <span aria-hidden="true">{count}</span>}
    </Badge>
  );
}
