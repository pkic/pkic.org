import { agendaContent } from "../../../../../../../shared/public-agenda-content";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { dateTimeLocalToIso, instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import type { ContentAgendaDay } from "../../../../../../../shared/site-agenda";

/** Organizer mode keeps the configured event range visible, including empty days and periods. */
export function agendaPresenter(snapshot: AgendaSnapshot, timeStep = 5) {
  const days = agendaContent(snapshot, true).days;
  if (!snapshot.eventStartsAt || !snapshot.eventEndsAt) return days;
  const first = Date.parse(snapshot.eventStartsAt);
  const last = Date.parse(snapshot.eventEndsAt);
  if (last <= first) return days;
  const byDate = new Map(days.map((day) => [day.date, day]));
  const opening = instantToDateTimeLocal(snapshot.eventStartsAt, snapshot.timeZone).slice(11);
  const closing = instantToDateTimeLocal(snapshot.eventEndsAt, snapshot.timeZone).slice(11);
  const dailyHours = closing > opening;
  let date = instantToDateTimeLocal(snapshot.eventStartsAt, snapshot.timeZone).slice(0, 10);
  while (true) {
    const following = new Date(`${date}T00:00:00.000Z`);
    following.setUTCDate(following.getUTCDate() + 1);
    const nextDate = following.toISOString().slice(0, 10);
    const midnight = Date.parse(dateTimeLocalToIso(`${date}T00:00`, snapshot.timeZone));
    if (midnight >= last) break;
    let dayStart = Math.max(
      first,
      Date.parse(dateTimeLocalToIso(`${date}T${dailyHours ? opening : "00:00"}`, snapshot.timeZone)),
    );
    let dayEnd = Math.min(
      last,
      Date.parse(dateTimeLocalToIso(dailyHours ? `${date}T${closing}` : `${nextDate}T00:00`, snapshot.timeZone)),
    );
    const day: ContentAgendaDay = byDate.get(date) ?? {
      date,
      locations: snapshot.rooms.map((room) => ({ id: room.id, label: room.name })),
      slots: [],
    };
    // Existing authored sessions can extend the planning display without changing their instants.
    for (const slot of day.slots) {
      dayStart = Math.min(dayStart, Date.parse(slot.startsAt));
      dayEnd = Math.max(dayEnd, Date.parse(slot.startsAt));
    }
    const slots = new Map(day.slots.map((slot) => [slot.startsAt, slot]));
    for (let instant = dayStart; instant <= dayEnd; instant = Math.min(instant + timeStep * 60_000, dayEnd)) {
      const startsAt = new Date(instant).toISOString();
      if (!slots.has(startsAt))
        slots.set(startsAt, {
          startsAt,
          time: instantToDateTimeLocal(startsAt, snapshot.timeZone).slice(11),
          sessions: [],
        });
      if (instant === dayEnd) break;
    }
    day.slots = [...slots.values()].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    byDate.set(date, day);
    date = nextDate;
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}
