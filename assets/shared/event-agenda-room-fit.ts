import { agendaConflicts, agendaDutyIntervalsConflict, agendaRoomIsAvailable } from "./event-agenda-policy";
import { agendaOccurrenceRoomIds, agendaMovedSpeakers, agendaSpeakerPhysicalRoom } from "./event-agenda-rooms";
import type { AgendaSnapshot } from "./schemas/event-agenda";
export function evaluateRoomFits(
  snapshot: AgendaSnapshot,
  occurrenceId: string,
  protectedRooms: string[],
  physicalDemand: number,
  unallocatedDemand: number,
  roomOccupancy: Record<string, number> = {},
  blockedRooms: string[] = [],
) {
  const session = snapshot.occurrences.find((item) => item.id === occurrenceId);
  if (!session) return [];
  const oldRooms = agendaOccurrenceRoomIds(session);
  return snapshot.rooms
    .map((room) => {
      const preserved = oldRooms.filter(
        (id) => id !== room.id && (id !== session.roomId || protectedRooms.includes(id)),
      );
      const candidate = {
        ...session,
        roomId: room.id,
        additionalRoomIds: preserved,
        speakers: agendaMovedSpeakers(session, room.id),
      };
      const reasons: string[] = [],
        reviewReasons: string[] = [];
      const newRoomDemand = protectedRooms.includes(room.id)
        ? (roomOccupancy[room.id] ?? 0) + unallocatedDemand
        : protectedRooms.length
          ? unallocatedDemand
          : physicalDemand;
      if (room.capacity === 0) reasons.push("This room is closed to physical attendance.");
      if (blockedRooms.includes(room.id))
        reasons.push("A credited person has conflicting cross-event or meeting availability; details remain private.");
      if (room.capacity !== null && room.capacity < newRoomDemand)
        reasons.push("Room capacity is below the physical demand assigned to this proposal.");
      if (session.capacity !== null && session.capacity < physicalDemand)
        reviewReasons.push(
          "The session limit must also increase before queued demand can be allocated; room capacities are not added together.",
        );
      for (const placed of snapshot.rooms.filter((item) => agendaOccurrenceRoomIds(candidate).includes(item.id))) {
        if ((session.requiredEquipment ?? []).some((equipment) => !placed.equipment?.includes(equipment)))
          reasons.push(`${placed.name} does not provide all required equipment.`);
        if (session.startAt && session.endAt && !agendaRoomIsAvailable(placed, session.startAt, session.endAt))
          reasons.push(`${placed.name} is unavailable during the session and setup interval.`);
      }
      if (!session.startAt || !session.endAt)
        reasons.push("Choose the session time before location availability can be verified.");
      else {
        for (const other of snapshot.occurrences)
          if (other.id !== session.id)
            reasons.push(...agendaConflicts([candidate, other], snapshot.travelMinutes, snapshot.rooms));
        for (const block of snapshot.blocks)
          if (
            snapshot.assignments.some(
              (assignment) =>
                assignment.blockId === block.id &&
                candidate.speakers.some(
                  (speaker) =>
                    speaker.userId === assignment.userId &&
                    agendaDutyIntervalsConflict(
                      {
                        startAt: session.startAt!,
                        endAt: session.endAt!,
                        roomId: agendaSpeakerPhysicalRoom(candidate, speaker),
                      },
                      block,
                      speaker.attendanceMode === "remote" ||
                        snapshot.roleMembers.find((member) => member.userId === assignment.userId)?.attendanceMode ===
                          "remote"
                        ? 0
                        : snapshot.travelMinutes,
                    ),
                ),
            )
          )
            reasons.push("A credited person has an overlapping staff duty or travel interval.");
      }
      if (preserved.includes(session.roomId ?? "") && room.id !== session.roomId)
        reviewReasons.push(
          "Existing allocations and waiting requests keep their chosen location. Review the added room and explicitly assign any new location before publication.",
        );
      const mustReview = reviewReasons.length > 0;
      return {
        roomId: room.id,
        name: room.name,
        capacity: room.capacity,
        equipment: room.equipment ?? [],
        fit: reasons.length ? ("unavailable" as const) : mustReview ? ("review" as const) : ("fits" as const),
        reasons: reasons.length
          ? [...new Set(reasons)]
          : reviewReasons.length
            ? reviewReasons
            : mustReview
              ? [
                  "Existing allocations remain in their original location. Review the added room and per-person assignments before publication.",
                ]
              : [
                  "Fits the current local schedule and physical demand. Final save and approval recheck all constraints.",
                ],
        proposedRoomId: room.id,
        proposedAdditionalRoomIds: preserved,
        proposedCapacity: session.capacity !== null ? Math.max(session.capacity, physicalDemand) : null,
        physicalDemand,
        newRoomDemand,
      };
    })
    .sort(
      (a, b) =>
        ({ fits: 0, review: 1, unavailable: 2 })[a.fit] - { fits: 0, review: 1, unavailable: 2 }[b.fit] ||
        (a.capacity ?? Number.MAX_SAFE_INTEGER) - (b.capacity ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    );
}
