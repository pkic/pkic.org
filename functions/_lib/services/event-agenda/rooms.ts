import type { z } from "zod";
import type { agendaRoomCreateSchema } from "../../../../assets/shared/schemas/event-agenda";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { getAgenda } from "./read";
import { commitAgendaRevision, validateAgendaSchedule } from "./mutations";
import { assertPublicationCapacity, preparePublicationCapacityGuard } from "./publication-capacity";

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
          }
        : room,
    ),
  };
  validateAgendaSchedule(proposed, proposed.occurrences);
  await assertPublicationCapacity(db, proposed);
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [
      db
        .prepare(
          "UPDATE event_agenda_rooms SET name=?,capacity=?,setup_minutes=?,equipment_json=?,available_periods_json=? WHERE id=? AND event_id=?",
        )
        .bind(
          input.name,
          input.capacity,
          input.setupMinutes,
          JSON.stringify(input.equipment ?? []),
          JSON.stringify(input.availablePeriods ?? []),
          roomId,
          eventId,
        ),
      preparePublicationCapacityGuard(db, proposed),
    ],
    actorUserId,
  );
  return getAgenda(db, eventId, eventSlug);
}
