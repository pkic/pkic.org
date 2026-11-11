import { agendaRoomOrderRouteSchema } from "../../../../../../assets/shared/schemas/event-agenda-room-order";
import { reorderAgendaRooms } from "../../../../../_lib/services/event-agenda/rooms";
import {
  AGENDA_ROOM_LIST_PERMISSIONS,
  agendaRoomsGetRouteSchema,
} from "../../../../../../assets/shared/schemas/event-agenda-room-list";
import { guardPermissionDatabase } from "../../../../../_lib/auth/permissions";
import { AppError } from "../../../../../_lib/errors";
import { json } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { listAgendaRooms } from "../../../../../_lib/services/event-agenda/room-list";
import { requireAnyEventPermission } from "../authorization";
import { authorize } from "./index";

export const AgendaRoomsGet = openApiRoute(agendaRoomsGetRouteSchema, async (c, data) => {
  const { db, event, actor, context, permission } = await requireAnyEventPermission(
    c,
    data.params.eventSlug,
    AGENDA_ROOM_LIST_PERMISSIONS,
  );
  const guarded = guardPermissionDatabase(
    db,
    actor,
    [{ permission, context }],
    () => new AppError(409, "AGENDA_AUTHORIZATION_CHANGED", "Agenda permission changed"),
  );
  return json(await listAgendaRooms(guarded, event.id, data.query, { virtualRoomLinks: permission === "agenda:read" }));
});

export const AgendaRoomsOrderPost = openApiRoute(agendaRoomOrderRouteSchema, async (c, data) => {
  const { db, event, actor } = await authorize(c, data.params.eventSlug, true);
  return json(await reorderAgendaRooms(db, event.id, event.slug, data.body, actor.id));
});
