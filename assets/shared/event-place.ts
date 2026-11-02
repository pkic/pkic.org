/**
 * Where an event takes place: its city and its country's ISO 3166-1 alpha-2
 * code. The two are stored and transported apart; this module is the one
 * place that composes them into a line a reader sees ("Amsterdam,
 * Netherlands"), naming the country for the reader's locale.
 *
 * The venue's address is a separate setting, and how people attend (in
 * person, online) belongs to the event's attendance options, so neither is
 * ever folded into the city.
 */
import { z } from "zod";
import { countryCodeSchema, countryName } from "./countries";
import { standaloneEventProfileKeySchema } from "./schemas/event-series";

export const EVENT_CITY_MAX_LENGTH = 80;

/** A city as an organizer enters it: "Amsterdam", "Kuala Lumpur". */
export const eventCitySchema = z
  .string()
  .trim()
  .min(1, "Enter the city.")
  .max(EVENT_CITY_MAX_LENGTH, `Use at most ${String(EVENT_CITY_MAX_LENGTH)} characters.`);

/** The place fields every event projection carries; null until an organizer sets them. */
export const eventPlaceSchema = z.object({
  city: z.string().nullable(),
  country: countryCodeSchema.nullable(),
});
export type EventPlace = z.infer<typeof eventPlaceSchema>;

type PlaceFields = { readonly city?: string | null; readonly country?: string | null };

/**
 * "Amsterdam, Netherlands": the city and the country named for `locale`. A
 * missing half leaves the other on its own; null when neither is set.
 */
export function formatEventPlace(place: PlaceFields, locale?: string): string | null {
  const city = place.city?.trim() || null;
  const country = place.country ? countryName(place.country, locale) : null;
  return [city, country].filter(Boolean).join(", ") || null;
}

/** Whether an organizer still has to say where the event is. */
export function eventPlaceIncomplete(place: PlaceFields): boolean {
  return !place.city?.trim() || !place.country;
}

/**
 * Whether settings should ask for the event's city and country: a standalone
 * event without them. A meeting, in a series or not, meets in a room or a
 * call and keeps its zone's clock, so it is never asked.
 */
export function eventPlaceNeeded(
  event: PlaceFields & { readonly seriesId?: string | null; readonly profileKey?: string | null },
): boolean {
  if (event.seriesId || (event.profileKey && !standaloneEventProfileKeySchema.safeParse(event.profileKey).success))
    return false;
  return eventPlaceIncomplete(event);
}

/** The first part of an address line: a venue's name. */
function leadingPart(value: string | null | undefined): string | null {
  return value?.split(",")[0]?.trim() || null;
}

/**
 * Where the event is, once: the venue's name and the city ("Meervaart ·
 * Amsterdam"), not the venue's postal address followed by the city again.
 * The full address belongs on the event's venue details (More).
 */
export function eventPlaceSummary(event: {
  readonly venue?: string | null;
  readonly city?: string | null;
}): string | null {
  const venue = "venue" in event ? event.venue : null;
  const parts: string[] = [];
  for (const part of [leadingPart(venue), event.city?.trim() || null])
    if (part && !parts.some((seen) => seen.toLocaleLowerCase() === part.toLocaleLowerCase())) parts.push(part);
  return parts.length ? parts.join(" · ") : null;
}
