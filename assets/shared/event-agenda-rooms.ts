import type { AgendaOccurrence } from "./schemas/event-agenda";
/** A session is one canonical occurrence, with stable placements in each reserved physical room. */
export function agendaOccurrenceRoomIds(occurrence: Pick<AgendaOccurrence, "roomId" | "additionalRoomIds">) {
  return [...new Set([...(occurrence.roomId ? [occurrence.roomId] : []), ...(occurrence.additionalRoomIds ?? [])])];
}
export function agendaOccurrencePlacements(occurrence: AgendaOccurrence) {
  const rooms = agendaOccurrenceRoomIds(occurrence);
  return rooms.length
    ? rooms.map((roomId) => ({ key: `${occurrence.id}:${roomId}`, roomId, occurrence }))
    : [{ key: occurrence.id, roomId: null, occurrence }];
}

/** Moving the primary placement to an existing reserved room swaps their roles. */
export function agendaMovedAdditionalRoomIds(
  occurrence: Pick<AgendaOccurrence, "roomId" | "additionalRoomIds">,
  nextRoomId: string | null,
) {
  if (!nextRoomId) return [];
  return (occurrence.additionalRoomIds ?? []).flatMap((id) =>
    id === nextRoomId ? (occurrence.roomId ? [occurrence.roomId] : []) : [id],
  );
}

/** Explicit primary-room speakers follow that primary move; deliberate additional-room placements stay put. */
export function agendaMovedSpeakers(
  occurrence: Pick<AgendaOccurrence, "roomId" | "speakers">,
  nextRoomId: string | null,
) {
  return occurrence.speakers.map((speaker) =>
    occurrence.roomId &&
    occurrence.roomId !== nextRoomId &&
    speaker.attendanceMode !== "remote" &&
    speaker.roomId === occurrence.roomId
      ? { ...speaker, roomId: nextRoomId }
      : speaker,
  );
}

/** Explicit speaker placement overrides the session primary room; remote speakers have no physical location. */
export function agendaSpeakerPhysicalRoom(
  occurrence: Pick<AgendaOccurrence, "roomId">,
  speaker: AgendaOccurrence["speakers"][number],
) {
  return speaker.attendanceMode === "remote" ? null : (speaker.roomId ?? occurrence.roomId);
}
