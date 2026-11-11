import { agendaRoomSchema } from "./event-agenda";
import { eventSlugParamsSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { authErrors, ok, requiresAnyPermissions } from "./route-contract";
import { SCREEN_MANAGE_PERMISSION } from "../event-screen-permissions";
import type { Permission } from "./permissions";

/**
 * Who may list an event's rooms: agenda readers, and staff who manage screens,
 * who assign a screen to a room. Room names are not sensitive; a room's
 * virtual-room link is, so only agenda readers receive it.
 */
export const AGENDA_ROOM_LIST_PERMISSIONS = ["agenda:read", SCREEN_MANAGE_PERMISSION] as const satisfies readonly [
  Permission,
  ...Permission[],
];

export const agendaRoomsQuerySchema = listQuerySchema(["name", "capacity"] as const);
export const agendaRoomsListSchema = paginatedResponseSchema("rooms", agendaRoomSchema);

export const agendaRoomsGetRouteSchema = {
  tags: ["Event agenda"],
  summary: "List agenda locations",
  request: { params: eventSlugParamsSchema, query: agendaRoomsQuerySchema },
  responses: {
    ...ok("Agenda locations", agendaRoomsListSchema),
    ...authErrors({ badRequest: "Invalid location query", notFound: "Event not found" }),
  },
  ...requiresAnyPermissions(...AGENDA_ROOM_LIST_PERMISSIONS.map((permission) => [permission])),
};
