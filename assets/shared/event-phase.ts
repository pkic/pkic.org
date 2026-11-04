export const EVENT_PHASES = ["now", "upcoming", "past"] as const;
export type EventPhase = (typeof EVENT_PHASES)[number];

export const UPCOMING_EVENT_MONTHS = 6;

/** The card badge describes the next six calendar months; discovery still includes all future events. */
export function withinUpcomingEventWindow(startsAt: string | null | undefined, at = Date.now()): boolean {
  if (!startsAt || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(startsAt) || !Number.isFinite(at)) return false;
  const cutoff = new Date(at);
  const lastDay = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + UPCOMING_EVENT_MONTHS + 1, 0),
  ).getUTCDate();
  cutoff.setUTCMonth(cutoff.getUTCMonth() + UPCOMING_EVENT_MONTHS, Math.min(cutoff.getUTCDate(), lastDay));
  const day = startsAt.slice(0, 10);
  return day >= new Date(at).toISOString().slice(0, 10) && day <= cutoff.toISOString().slice(0, 10);
}

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
