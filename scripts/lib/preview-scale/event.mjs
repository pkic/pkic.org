import { dateTimeLocalToIso } from "../../../assets/shared/timezone.ts";
import { sqlString, NOW } from "../sql.mjs";
import { previewScaleId } from "../seed-ids.mjs";

/** A seeded event's days run from 08:00 to 18:00 local time, matching the agenda. */
const DAY_START = "08:00";
const DAY_END = "18:00";

function addDays(date, count) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

/**
 * The context for an event the seed creates: its id and days derive from the
 * slug, so a re-run finds the same event. It starts invitation-only, as every
 * new event does, so it stays off the public event list.
 * @param {{ slug: string, name: string, start: string, dayCount: number, timeZone: string }} options
 */
export function newEvent({ slug, name, start, dayCount, timeZone }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error(`Not an event slug: ${slug}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || addDays(start, 0) !== start) throw new Error(`Not a date: ${start}`);
  const dates = Array.from({ length: dayCount }, (_, index) => addDays(start, index));
  const at = (date, clock) => dateTimeLocalToIso(`${date}T${clock}`, timeZone);
  const eventId = previewScaleId(`event:${slug}`);
  return {
    slug,
    name,
    eventId,
    timeZone,
    startsAt: at(dates[0], DAY_START),
    eventEndsAt: at(dates.at(-1), DAY_END),
    days: dates.map((date, index) => ({
      id: previewScaleId(`event:${slug}:day:${date}`),
      date,
      sortOrder: index,
      startsAt: at(date, DAY_START),
      endsAt: at(date, DAY_END),
    })),
    roomOrder: [],
    rooms: [],
    visibleOccurrenceIds: [],
  };
}

/** Creates the event and its days; an event that already exists is left as it is. */
export function newEventStatements(event) {
  const days = event.days
    .map(
      (day) =>
        `(${[day.id, event.eventId, day.date, `Day ${day.sortOrder + 1}`, day.startsAt, day.endsAt].map(sqlString).join(", ")}, ${day.sortOrder}, ${NOW}, ${NOW})`,
    )
    .join(",\n");
  return [
    `INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, created_at, updated_at)
VALUES (${[event.eventId, event.slug, event.name, event.timeZone, event.startsAt, event.eventEndsAt].map(sqlString).join(", ")}, ${NOW}, ${NOW})
ON CONFLICT DO NOTHING;`,
    `INSERT INTO event_days (id, event_id, day_date, label, starts_at, ends_at, sort_order, created_at, updated_at) VALUES
${days}
ON CONFLICT DO NOTHING;`,
  ];
}
