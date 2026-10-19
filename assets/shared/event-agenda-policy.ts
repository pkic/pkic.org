import { agendaOccurrenceRoomIds, agendaSpeakerPhysicalRoom } from "./event-agenda-rooms";
import type { AgendaOccurrence, AgendaSnapshot } from "./schemas/event-agenda";

export function intervalsOverlap(start: string, end: string, otherStart: string, otherEnd: string) {
  return start < otherEnd && otherStart < end;
}
export function agendaConflicts(
  occurrences: AgendaOccurrence[],
  travelMinutes = 0,
  rooms: Array<{ id: string; setupMinutes: number }> = [],
) {
  const conflicts: string[] = [];
  for (let i = 0; i < occurrences.length; i++) {
    const a = occurrences[i];
    if (!a.startAt || !a.endAt) continue;
    if (a.endAt <= a.startAt) conflicts.push(`${a.title}: end must follow start`);
    for (const b of occurrences.slice(i + 1)) {
      if (!b.startAt || !b.endAt) continue;
      const gap =
        Math.max(Date.parse(a.startAt) - Date.parse(b.endAt), Date.parse(b.startAt) - Date.parse(a.endAt)) / 60000;
      const overlap = intervalsOverlap(a.startAt, a.endAt, b.startAt, b.endAt);
      const sharedRooms = agendaOccurrenceRoomIds(a).filter((roomId) => agendaOccurrenceRoomIds(b).includes(roomId));
      const setup = Math.max(
        0,
        ...sharedRooms.map((roomId) => rooms.find((room) => room.id === roomId)?.setupMinutes ?? 0),
      );
      if (sharedRooms.length && !overlap && gap < setup)
        conflicts.push(`${a.title} and ${b.title} need room setup time`);
      if (
        gap < travelMinutes &&
        a.speakers.some(
          (speaker) =>
            speaker.attendanceMode !== "remote" &&
            b.speakers.some(
              (other) =>
                other.userId === speaker.userId &&
                other.attendanceMode !== "remote" &&
                agendaSpeakerPhysicalRoom(a, speaker) !== agendaSpeakerPhysicalRoom(b, other),
            ),
        )
      )
        conflicts.push(`${a.title} and ${b.title} need speaker travel time`);
      if (!overlap) continue;
      if (sharedRooms.length) conflicts.push(`${a.title} and ${b.title} overlap in the same room`);
      if (a.speakers.some((speaker) => b.speakers.some((other) => other.userId === speaker.userId)))
        conflicts.push(`${a.title} and ${b.title} share a speaker at the same time`);
    }
  }
  return conflicts;
}
export { agendaDutyIntervalsConflict } from "./event-agenda-intervals";
export { allocateAgendaRoles } from "./event-agenda-staffing";

export function agendaRoomIsAvailable(
  room: AgendaSnapshot["rooms"][number],
  startAt: string,
  endAt: string,
  includeSetup = true,
) {
  return (
    !room.availablePeriods?.length ||
    room.availablePeriods.some(
      (period) =>
        period.startAt <= startAt &&
        Date.parse(endAt) + (includeSetup ? room.setupMinutes * 60000 : 0) <= Date.parse(period.endAt),
    )
  );
}
