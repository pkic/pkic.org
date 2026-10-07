import type { AgendaShift, AgendaOccurrence } from "./schemas/event-agenda";
import { agendaOccurrenceRoomIds } from "./event-agenda-rooms";
import { agendaDutyIntervalsConflict } from "./event-agenda-intervals";

/** Room and authored track are independent scopes; both must match when specified. */
export function agendaStaffingShiftAppliesToOccurrence(shift: AgendaShift, occurrence: AgendaOccurrence): boolean {
  return Boolean(
    occurrence.startAt &&
    occurrence.endAt &&
    occurrence.startAt < shift.endAt &&
    shift.startAt < occurrence.endAt &&
    (!shift.roomId || agendaOccurrenceRoomIds(occurrence).includes(shift.roomId)) &&
    (!shift.track || occurrence.track === shift.track),
  );
}

/** A track may move rooms, but one physical person must still cover its actual intervals and travel. */
export function agendaStaffingTrackLocationConflict(
  shift: AgendaShift,
  occurrences: AgendaOccurrence[],
  travelMinutes: number,
  authoredScope: AgendaShift = shift,
): boolean {
  if (!shift.track) return false;
  const covered = occurrences.filter(
    (occurrence) =>
      agendaStaffingShiftAppliesToOccurrence(authoredScope, occurrence) &&
      agendaStaffingShiftAppliesToOccurrence(shift, occurrence),
  );
  if (!shift.roomId && covered.some((occurrence) => agendaOccurrenceRoomIds(occurrence).length > 1)) return true;
  const intervals = covered.map((occurrence) => ({
    startAt: occurrence.startAt! < shift.startAt ? shift.startAt : occurrence.startAt!,
    endAt: occurrence.endAt! > shift.endAt ? shift.endAt : occurrence.endAt!,
    roomId: shift.roomId ?? occurrence.roomId,
  }));
  return intervals.some((interval, index) =>
    intervals.slice(index + 1).some((other) => agendaDutyIntervalsConflict(interval, other, travelMinutes)),
  );
}
