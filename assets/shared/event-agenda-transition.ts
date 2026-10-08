import { agendaOccurrenceRoomIds } from "./event-agenda-rooms.ts";
import { instantToDateTimeLocal } from "./timezone.ts";
import type { AgendaOccurrence } from "./schemas/event-agenda";

/** Attendee room changes are distinct from canonical speaker/staff travel constraints. */
export const DEFAULT_AGENDA_TRANSITION_MINUTES = 5;
type TimedOccurrence = Pick<AgendaOccurrence, "id" | "kind" | "startAt" | "endAt" | "roomId" | "additionalRoomIds">;

/** Derive presentation time without mutating the advertised or bookable slot. */
export function agendaSessionPresentationTiming(
  occurrence: TimedOccurrence,
  occurrences: readonly TimedOccurrence[],
  timeZone: string,
  transitionMinutes = DEFAULT_AGENDA_TRANSITION_MINUTES,
): { contentDurationMinutes?: number; transitionMinutes?: number } {
  if (occurrence.kind === "break" || !occurrence.startAt || !occurrence.endAt || transitionMinutes <= 0) return {};
  const duration = (Date.parse(occurrence.endAt) - Date.parse(occurrence.startAt)) / 60_000;
  if (duration <= transitionMinutes) return {};
  const rooms = agendaOccurrenceRoomIds(occurrence);
  if (!rooms.length) return {};
  const date = instantToDateTimeLocal(occurrence.startAt, timeZone).slice(0, 10);
  if (instantToDateTimeLocal(occurrence.endAt, timeZone).slice(0, 10) !== date) return {};
  // A real existing gap already provides handover, including imported legacy timing.
  const following = occurrences.filter(
    (next) =>
      next.id !== occurrence.id &&
      next.startAt &&
      next.startAt === occurrence.endAt &&
      next.endAt &&
      next.endAt > next.startAt,
  );
  if (
    following.some(
      (next) =>
        next.kind === "break" &&
        (!agendaOccurrenceRoomIds(next).length || agendaOccurrenceRoomIds(next).some((room) => rooms.includes(room))),
    )
  )
    return {};
  const talks = following.filter((next) => next.kind === "session" && agendaOccurrenceRoomIds(next).length);
  const parallel = talks.some((talk, index) =>
    talks
      .slice(index + 1)
      .some((other) => !agendaOccurrenceRoomIds(talk).some((room) => agendaOccurrenceRoomIds(other).includes(room))),
  );
  return parallel ? { contentDurationMinutes: duration - transitionMinutes, transitionMinutes } : {};
}
