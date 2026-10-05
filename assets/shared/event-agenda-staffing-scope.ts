import type { AgendaBlock, AgendaOccurrence } from "./schemas/event-agenda";
import { agendaOccurrenceRoomIds } from "./event-agenda-rooms";
import { agendaDutyIntervalsConflict } from "./event-agenda-intervals";

/** Room and authored track are independent scopes; both must match when specified. */
export function agendaStaffingBlockAppliesToOccurrence(block: AgendaBlock, occurrence: AgendaOccurrence): boolean {
  return Boolean(
    occurrence.startAt &&
    occurrence.endAt &&
    occurrence.startAt < block.endAt &&
    block.startAt < occurrence.endAt &&
    (!block.roomId || agendaOccurrenceRoomIds(occurrence).includes(block.roomId)) &&
    (!block.track || occurrence.track === block.track),
  );
}

/** A track may move rooms, but one physical person must still cover its actual intervals and travel. */
export function agendaStaffingTrackLocationConflict(
  block: AgendaBlock,
  occurrences: AgendaOccurrence[],
  travelMinutes: number,
  authoredScope: AgendaBlock = block,
): boolean {
  if (!block.track) return false;
  const covered = occurrences.filter(
    (occurrence) =>
      agendaStaffingBlockAppliesToOccurrence(authoredScope, occurrence) &&
      agendaStaffingBlockAppliesToOccurrence(block, occurrence),
  );
  if (!block.roomId && covered.some((occurrence) => agendaOccurrenceRoomIds(occurrence).length > 1)) return true;
  const intervals = covered.map((occurrence) => ({
    startAt: occurrence.startAt! < block.startAt ? block.startAt : occurrence.startAt!,
    endAt: occurrence.endAt! > block.endAt ? block.endAt : occurrence.endAt!,
    roomId: block.roomId ?? occurrence.roomId,
  }));
  return intervals.some((interval, index) =>
    intervals.slice(index + 1).some((other) => agendaDutyIntervalsConflict(interval, other, travelMinutes)),
  );
}
