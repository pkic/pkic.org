import { AppError } from "../../errors";
import { agendaOccurrenceRoomIds } from "../../../../assets/shared/event-agenda-rooms";
/** Physical multi-room attendance always names its allocated location. */
export function resolvePhysicalSessionRoom(
  session: { room_id: string | null; additional_room_ids_json?: string | null },
  requested?: string | null,
) {
  const rooms = agendaOccurrenceRoomIds({
    roomId: session.room_id,
    additionalRoomIds: JSON.parse(session.additional_room_ids_json ?? "[]"),
  });
  if (rooms.length > 1 && !requested)
    throw new AppError(400, "SESSION_ROOM_REQUIRED", "Choose the physical room where you will attend.");
  const selected = requested ?? session.room_id;
  if (selected && !rooms.includes(selected))
    throw new AppError(400, "SESSION_ROOM_INVALID", "Choose a room reserved for this session.");
  return selected;
}
