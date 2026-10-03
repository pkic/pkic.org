import { escapeHtml } from "../../../../../../shared/ui";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import type { ContentAgendaDay } from "../../../../../../../shared/site-agenda";
import { instantToDateTimeLocal } from "../../../../../../../shared/timezone";

/** Translate API transport to the same presenter used by build-time public pages. */
export function agendaPresenter(snapshot: AgendaSnapshot): ContentAgendaDay[] {
  const days = new Map<string, ContentAgendaDay>();
  for (const occurrence of snapshot.occurrences) {
    if (!occurrence.startAt || !occurrence.endAt || !occurrence.roomId) continue;
    const wall = instantToDateTimeLocal(occurrence.startAt, snapshot.timeZone);
    const date = wall.slice(0, 10);
    let day = days.get(date);
    if (!day) {
      day = { date, locations: snapshot.rooms.map((room) => ({ id: room.id, label: room.name })), slots: [] };
      days.set(date, day);
    }
    let slot = day.slots.find((value) => value.startsAt === occurrence.startAt);
    if (!slot) {
      slot = { startsAt: occurrence.startAt, time: wall.slice(11), sessions: [] };
      day.slots.push(slot);
    }
    slot.sessions.push({
      id: occurrence.id,
      presentationUrl: occurrence.presentationUrl ?? undefined,
      recordingUrl: occurrence.recordingUrl ?? undefined,
      title: occurrence.title,
      descriptionHtml: escapeHtml(occurrence.description).replaceAll("\n", "<br>"),
      endsAt: occurrence.endAt,
      durationMinutes: (Date.parse(occurrence.endAt) - Date.parse(occurrence.startAt)) / 60000,
      locations: [occurrence.roomId],
      speakers: occurrence.speakers.map((speaker) => ({ name: speaker.displayName })),
    });
  }
  for (const day of days.values()) {
    for (const occurrence of snapshot.occurrences) {
      if (
        !occurrence.endAt ||
        !occurrence.startAt ||
        instantToDateTimeLocal(occurrence.startAt, snapshot.timeZone).slice(0, 10) !== day.date ||
        day.slots.some((slot) => slot.startsAt === occurrence.endAt)
      )
        continue;
      day.slots.push({
        startsAt: occurrence.endAt,
        time: instantToDateTimeLocal(occurrence.endAt, snapshot.timeZone).slice(11),
        sessions: [],
      });
    }
  }
  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({ ...day, slots: day.slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt)) }));
}
