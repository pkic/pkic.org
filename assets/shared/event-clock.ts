/**
 * Whose clock an event's times are on, and what to call it.
 *
 * An event's times live on its IANA zone, but readers know the event by its
 * city: Austin runs on `America/Chicago`, and "Chicago time" names a place
 * the event is not in. The city is the event's own `city` field; the zone
 * stays the only thing any conversion reads. Without a city the zone's own city
 * names the clock (`formatClockName` in `format-date.ts`).
 *
 * A viewer's own zone or a zone picked from a list is not an event clock and
 * is passed as a bare IANA identifier.
 */

import { z } from "zod";
import { EVENT_CITY_MAX_LENGTH } from "./event-place";

/** An event's IANA zone together with the city the event is in, when it has one. */
export interface EventClock {
  readonly timeZone: string;
  readonly city: string | null;
}

/** What a formatter accepts: an event's clock, or a bare IANA zone named by its own city. */
export type ClockZone = string | EventClock;

/** A contract's `clockCity`: the event's city, or null when the zone names the clock. */
export const clockCitySchema = z.string().trim().min(1).max(EVENT_CITY_MAX_LENGTH).nullable();

/** The city that names an event's clock: its own city, or null so the zone's city names it. */
export function eventClockCity(city: string | null | undefined): string | null {
  return city?.trim() || null;
}

/**
 * An event's clock from its zone and city. A meeting series has no city of its
 * own (its location names a room or a call), so a series event keeps the
 * zone's city.
 */
export function eventClock(event: {
  readonly timezone: string;
  readonly city?: string | null;
  readonly seriesId?: string | null;
}): EventClock {
  return { timeZone: event.timezone, city: event.seriesId ? null : eventClockCity(event.city) };
}

/** The IANA zone every conversion reads, whichever kind of clock was given. */
export function clockTimeZone(zone: ClockZone): string {
  return typeof zone === "string" ? zone : zone.timeZone;
}

/** The clock a contract carries as its zone and its projected event city (`clockCity`). */
export function contractClock(source: { readonly timeZone: string; readonly clockCity?: string | null }): EventClock {
  return { timeZone: source.timeZone, city: source.clockCity ?? null };
}

/**
 * The clock for a value a contract carries on `timeZone`: the event's own clock when the value is
 * on the event's zone, otherwise that zone by its own city.
 */
export function clockForZone(clock: ClockZone | null | undefined, timeZone: string): ClockZone {
  return clock && typeof clock !== "string" && clock.timeZone === timeZone ? clock : timeZone;
}
