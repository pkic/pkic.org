import { agendaRoomSchema } from "./event-agenda";
import { eventSlugParamsSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { authErrors, ok, requiresPermissions } from "./route-contract";

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
  ...requiresPermissions("agenda:read"),
};
