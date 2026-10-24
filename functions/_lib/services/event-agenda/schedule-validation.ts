import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { agendaConflicts, agendaRoomIsAvailable } from "../../../../assets/shared/event-agenda-policy";
import { agendaOccurrenceRequiredEquipment } from "../../../../assets/shared/event-agenda-media";
import { agendaEventWindowViolations } from "../../../../assets/shared/event-agenda-event-window";
import { agendaOccurrenceRoomIds } from "../../../../assets/shared/event-agenda-rooms";
import {
  agendaScheduleConflictDetailsSchema,
  type AgendaScheduleConflictProposal,
} from "../../../../assets/shared/schemas/event-agenda-schedule";
import { AppError } from "../../errors";

export function validateAgendaSchedule(
  snapshot: Pick<
    AgendaSnapshot,
    "travelMinutes" | "rooms" | "eventStartsAt" | "eventEndsAt" | "shifts" | "assignments"
  >,
  items: AgendaSnapshot["occurrences"],
  conflictProposal?: AgendaScheduleConflictProposal,
) {
  const conflicts = agendaConflicts(items, snapshot.travelMinutes, snapshot.rooms);
  for (const item of items) {
    if (item.bookingOpensAt && item.bookingClosesAt && item.bookingOpensAt >= item.bookingClosesAt)
      conflicts.push(`${item.title}: booking closing time must follow opening time`);
    const outside = agendaEventWindowViolations(item, snapshot);
    if (outside.startsBefore) conflicts.push(`${item.title}: session starts before the event`);
    if (outside.endsAfter) conflicts.push(`${item.title}: session ends after the event`);
    if (Boolean(item.startAt) !== Boolean(item.endAt)) conflicts.push(`${item.title}: both start and end are required`);
    if ((item.additionalRoomIds?.length ?? 0) > 0 && !item.roomId)
      conflicts.push(`${item.title}: choose a primary room`);
    if (item.roomId && item.additionalRoomIds?.includes(item.roomId))
      conflicts.push(`${item.title}: primary room is already reserved`);
    const roomIds = agendaOccurrenceRoomIds(item);
    for (const speaker of item.speakers) {
      if (speaker.attendanceMode !== "remote" && speaker.roomId && !roomIds.includes(speaker.roomId))
        conflicts.push(`${item.title}: a physical speaker location is not reserved for this session`);
      if (speaker.attendanceMode === "remote" && speaker.roomId)
        conflicts.push(`${item.title}: a remote speaker cannot have a physical location`);
    }
    for (const roomId of roomIds) {
      const room = snapshot.rooms.find((candidate) => candidate.id === roomId);
      if (!room) {
        conflicts.push(`${item.title}: room does not belong to this event`);
        continue;
      }
      if (item.startAt && item.endAt && !agendaRoomIsAvailable(room, item.startAt, item.endAt))
        conflicts.push(`${item.title}: ${room.name} is unavailable for this session and setup time`);
      for (const equipment of agendaOccurrenceRequiredEquipment(item))
        if (!room.equipment?.includes(equipment))
          conflicts.push(`${item.title}: ${room.name} does not provide ${equipment}`);
      if (roomIds.length === 1 && room.capacity !== null && item.capacity !== null && item.capacity > room.capacity)
        conflicts.push(`${item.title}: session capacity exceeds room capacity`);
    }
  }
  for (const shift of snapshot.shifts) {
    const room = snapshot.rooms.find((candidate) => candidate.id === shift.roomId);
    if (room && !agendaRoomIsAvailable(room, shift.startAt, shift.endAt, false))
      conflicts.push(`${shift.name}: ${room.name} is unavailable for this staffing shift`);
  }
  for (const assignment of snapshot.assignments) {
    const shift = snapshot.shifts.find((item) => item.id === assignment.shiftId);
    if (
      shift &&
      items.some(
        (item) =>
          item.startAt &&
          item.endAt &&
          item.startAt < shift.endAt &&
          shift.startAt < item.endAt &&
          item.speakers.some((speaker) => speaker.userId === assignment.userId),
      )
    )
      conflicts.push("A speaker has an overlapping shift duty");
  }
  if (conflicts.length)
    throw new AppError(
      409,
      "AGENDA_SCHEDULE_CONFLICT",
      "This change conflicts with the agenda",
      agendaScheduleConflictDetailsSchema.parse({ conflicts, proposal: conflictProposal }),
    );
}
