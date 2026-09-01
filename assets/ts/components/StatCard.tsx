/**
 * The portal's stat tile, rendered by the design system's StatCard.
 *
 * Two translations live here, and neither belongs in the system:
 *
 *   - `value` arrives as a number from every analytics endpoint. The system
 *     takes a string, because "412", "78%" and "3 / 5 required" are all
 *     legitimate values and only the caller knows how one should read.
 *   - `variant` tinted the number. The system has no such variant on purpose:
 *     roughly one man in twelve cannot separate the red from the green, so a
 *     tinted number says nothing to them that the untinted one did not. The
 *     meaning is kept by saying it — the state becomes the first clause of the
 *     note, ahead of whatever the caller already wrote there.
 *
 * Keeping the prop means no call site changes; keeping the meaning means the
 * tint is not simply dropped on the floor.
 */

import { StatCard as SystemStatCard } from "../ui/StatCard";

export type StatCardVariant = "default" | "success" | "warning" | "danger" | "info";

interface StatCardProps {
  label: string;
  value: number | string;
  note?: string;
  variant?: StatCardVariant;
  href?: string;
}

/** What each tint was being used to say, in words. */
const VARIANT_NOTE: Record<Exclude<StatCardVariant, "default">, string> = {
  success: "Healthy",
  warning: "Needs attention",
  danger: "Needs attention",
  info: "For information",
};

export function StatCard({ label, value, note, variant = "default", href }: StatCardProps) {
  const state = variant === "default" ? null : VARIANT_NOTE[variant];
  const fullNote = [state, note?.trim()].filter(Boolean).join(" · ");

  return <SystemStatCard label={label} value={String(value)} note={fullNote || undefined} href={href} />;
}
