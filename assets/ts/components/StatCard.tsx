/**
 * The portal's stat tile, rendered by the design system's StatCard.
 *
 * Two translations live here, and neither belongs in the system:
 *
 *   - `value` arrives as a number from every analytics endpoint. The system
 *     takes a string, because "412", "78%" and "3 / 5 required" are all
 *     legitimate values and only the caller knows how one should read.
 *   - `variant` tinted the number. Roughly one man in twelve cannot separate
 *     the red from the green, so the tint alone says nothing to them. The
 *     meaning is kept by saying it — the state becomes the first clause of
 *     the note — and the tint becomes the system card's tone, so the reader
 *     who does see colour gets the Badge's own for that state.
 *
 * Keeping the prop means no call site changes; keeping the meaning means the
 * tint is not simply dropped on the floor.
 */

import { StatCard as SystemStatCard, type StatCardTone } from "../ui/StatCard";

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

/** The system tone each legacy tint maps onto. */
const VARIANT_TONE: Record<Exclude<StatCardVariant, "default">, StatCardTone> = {
  success: "ok",
  warning: "warn",
  danger: "danger",
  info: "info",
};

export function StatCard({ label, value, note, variant = "default", href }: StatCardProps) {
  const state = variant === "default" ? null : VARIANT_NOTE[variant];
  const fullNote = [state, note?.trim()].filter(Boolean).join(" · ");

  return (
    <SystemStatCard
      label={label}
      value={String(value)}
      note={fullNote || undefined}
      href={href}
      tone={variant === "default" ? undefined : VARIANT_TONE[variant]}
    />
  );
}
