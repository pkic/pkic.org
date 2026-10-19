import { agendaRoomOrderRouteSchema } from "../../../../../../assets/shared/schemas/event-agenda-room-order";
import { reorderAgendaRooms } from "../../../../../_lib/services/event-agenda/rooms";
import { agendaRoomsGetRouteSchema } from "../../../../../../assets/shared/schemas/event-agenda-room-list";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listAgendaRooms } from "../../../../../_lib/services/event-agenda/room-list";
import { authorize } from "./index";

export const AgendaRoomsGet = openApiRoute(agendaRoomsGetRouteSchema, async (c, data) => {
  const { db, event } = await authorize(c, data.params.eventSlug, false);
  return json(await listAgendaRooms(db, event.id, data.query));
});

export const AgendaRoomsOrderPost = openApiRoute(agendaRoomOrderRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await reorderAgendaRooms(db, event.id, event.slug, data.body, actor.id));
});
