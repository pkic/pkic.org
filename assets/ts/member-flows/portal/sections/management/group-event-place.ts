import { eventClock } from "../../../../../shared/event-clock";
import { formatEventPlace } from "../../../../../shared/event-place";
import { formatDateTimeAtPlace } from "../../../../../shared/format-date";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";

type GroupEventPlaceFields = Pick<GroupEvent, "city" | "country" | "meetingLocation">;

/**
 * Where a group event happens, as one line: an event's city and country
 * ("Amsterdam, Netherlands"), or a meeting series' room or call.
 */
export function groupEventPlace(event: GroupEventPlaceFields): string | null {
  return formatEventPlace(event) ?? event.meetingLocation;
}

/**
 * When and where, as one line. An event's place names its clock, so the city
 * is said once ("Dec 1, 2026, 09:00 · Amsterdam, Netherlands"); a meeting's
 * room or call is no clock, so its time keeps the zone's name beside it.
 */
export function groupEventWhenAndWhere(
  event: GroupEventPlaceFields & Pick<GroupEvent, "timezone" | "seriesId">,
  at: string | null,
): string {
  const clock = eventClock(event);
  const place = formatEventPlace(event);
  if (place) return formatDateTimeAtPlace(at, clock, place);
  const when = formatDateTimeAtPlace(at, clock, null);
  return event.meetingLocation ? `${when} · ${event.meetingLocation}` : when;
}
