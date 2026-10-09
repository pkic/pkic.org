import type { agendaRoomOrderSchema } from "../../../../assets/shared/schemas/event-agenda-room-order";
import { prepareAgendaRoomOrder } from "./room-order-settings";
import type { z } from "zod";
import type { agendaRoomCreateSchema } from "../../../../assets/shared/schemas/event-agenda";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { getAgenda } from "./read";
import { commitAgendaRevision, validateAgendaSchedule } from "./mutations";
import { assertPublicationAllocations, preparePublicationAllocationGuard } from "./publication-allocations";

export async function updateAgendaRoom(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  roomId: string,
  input: z.infer<typeof agendaRoomCreateSchema>,
  actorUserId: string,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  if (!snapshot.rooms.some((room) => room.id === roomId))
    throw new AppError(404, "AGENDA_ROOM_NOT_FOUND", "Location not found");
  const proposed = {
    ...snapshot,
    rooms: snapshot.rooms.map((room) =>
      room.id === roomId
        ? {
            id: roomId,
            name: input.name,
            capacity: input.capacity,
            setupMinutes: input.setupMinutes,
            equipment: input.equipment ?? [],
            availablePeriods: input.availablePeriods ?? [],
            ...(input.virtualRoomUrl ? { virtualRoomUrl: input.virtualRoomUrl } : {}),
          }
        : room,
    ),
  };
  validateAgendaSchedule(proposed, proposed.occurrences);
  await assertPublicationAllocations(db, proposed);
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [
      db
        .prepare(
          "UPDATE event_agenda_rooms SET name=?,capacity=?,setup_minutes=?,equipment_json=?,available_periods_json=?,virtual_room_url=? WHERE id=? AND event_id=?",
        )
        .bind(
          input.name,
          input.capacity,
          input.setupMinutes,
          JSON.stringify(input.equipment ?? []),
          JSON.stringify(input.availablePeriods ?? []),
          input.virtualRoomUrl ?? null,
          roomId,
          eventId,
        ),
      preparePublicationAllocationGuard(db, proposed),
      ...(await prepareAgendaRoomOrder(
        db,
        eventId,
        snapshot.rooms.map((room) => room.id),
      )),
    ],
    actorUserId,
  );
  return getAgenda(db, eventId, eventSlug);
}

export async function reorderAgendaRooms(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaRoomOrderSchema>,
  actorUserId: string,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  if (
    input.roomIds.length !== snapshot.rooms.length ||
    input.roomIds.some((id) => !snapshot.rooms.some((room) => room.id === id))
  )
    throw new AppError(400, "AGENDA_ROOM_ORDER_INVALID", "Choose every location in this event exactly once.");
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    await prepareAgendaRoomOrder(db, eventId, input.roomIds),
    actorUserId,
  );
  return getAgenda(db, eventId, eventSlug);
}
