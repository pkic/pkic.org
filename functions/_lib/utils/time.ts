export function nowIso(): string {
  return new Date().toISOString();
}

export function addMinutes(baseIso: string, minutes: number): string {
  return new Date(new Date(baseIso).getTime() + minutes * 60_000).toISOString();
}

export function addHours(baseIso: string, hours: number): string {
  return new Date(new Date(baseIso).getTime() + hours * 3_600_000).toISOString();
}

export function isPast(iso: string): boolean {
  return new Date(iso).getTime() <= Date.now();
}

/**
 * The calendar date an instant falls on, in UTC.
 *
 * The system operates in UTC and keeps date-only values as `YYYY-MM-DD`, so
 * this is the conversion at the boundary where a date is what belongs — a
 * sponsorship's start, a renewal — rather than the instant something was
 * recorded. Passing an instant straight into an email put
 * "as of 2026-09-07T13:34:41.870Z" in front of a sponsor (#32).
 *
 * A value that is already a calendar date is returned unchanged.
 */
export function calendarDateOf(value: string): string {
  return value.slice(0, 10);
}
