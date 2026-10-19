export const EVENT_PHASES = ["now", "upcoming", "past"] as const;
export type EventPhase = (typeof EVENT_PHASES)[number];

/** An unknown end never implies an event is still happening. */
export function eventPhase(
  event: { startsAt: string | null; endsAt: string | null },
  at = Date.now(),
): EventPhase | null {
  if (!event.startsAt) return null;
  const start = Date.parse(event.startsAt);
  if (!Number.isFinite(start)) return null;
  if (at < start) return "upcoming";
  return event.endsAt && at < Date.parse(event.endsAt) ? "now" : "past";
}
