import type { z } from "zod";
import type { agendaRoomCreateSchema } from "../../../../assets/shared/schemas/event-agenda";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import type { EventReadSelection } from "../events/selection";
import { readEventAdminResource } from "../events/authorized-context";
import { agendaWriteDatabase } from "./command-authorization";
import { prepareAgendaRead } from "./read";
import { planAgendaRoomOrder } from "./room-order-settings";
import { commitAgendaSnapshot } from "./commit-snapshot";

type RoomInput = z.infer<typeof agendaRoomCreateSchema>;

function prepareRoomCreation(db: DatabaseLike, event: EventReadSelection, eventSlug: string) {
  const read = prepareAgendaRead(db, event, eventSlug);
  const id = crypto.randomUUID();
  return {
    statements: read.statements,
    decode(loaded: D1StatementResult[], eventId: string) {
      const { snapshot, event } = read.decodeWithEvent(loaded);
      return {
        id,
        order: planAgendaRoomOrder(db, { id: eventId, settings_json: event.settings_json }, [
          ...snapshot.rooms.map((room) => room.id),
          id,
        ]),
      };
    },
  };
}

/** The standalone and HTTP adapters share one snapshot planner and one atomic command. */
export async function createAgendaRoom(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: RoomInput,
  actorUserId: string | null = null,
) {
  const read = prepareRoomCreation(db, eventId, eventSlug);
  return commitRoomCreation(
    db,
    eventId,
    eventSlug,
    input,
    read.decode(await db.batch(read.statements), eventId),
    actorUserId,
  );
}

export async function createAgendaRoomRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  input: RoomInput,
) {
  return readEventAdminResource(db, request, env, eventSlug, "agenda:write", (event) => {
    const read = prepareRoomCreation(db, event, eventSlug);
    return {
      statements: read.statements,
      decode(loaded, event, actor) {
        return commitRoomCreation(
          agendaWriteDatabase(db, actor, event.id),
          event.id,
          eventSlug,
          input,
          read.decode(loaded, event.id),
          actor.id,
        );
      },
    };
  });
}

function commitRoomCreation(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: RoomInput,
  plan: ReturnType<ReturnType<typeof prepareRoomCreation>["decode"]>,
  actorUserId: string | null,
) {
  return commitAgendaSnapshot(
    db,
    eventId,
    eventSlug,
    input.expectedRevision,
    [
      db
        .prepare(
          "INSERT INTO event_agenda_rooms(id,event_id,name,capacity,setup_minutes,equipment_json,available_periods_json,virtual_room_url) VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(
          plan.id,
          eventId,
          input.name,
          input.capacity,
          input.setupMinutes,
          JSON.stringify(input.equipment ?? []),
          JSON.stringify(input.availablePeriods ?? []),
          input.virtualRoomUrl ?? null,
        ),
      ...plan.order,
    ],
    actorUserId,
  );
}
