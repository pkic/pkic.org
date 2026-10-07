import { agendaBlockSchema } from "./event-agenda";
import { eventSlugParamsSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { authErrors, ok, requiresPermissions } from "./route-contract";

export const agendaBlocksQuerySchema = listQuerySchema(["name", "startAt", "endAt"] as const).extend({
  roomId: agendaBlockSchema.shape.roomId.unwrap().optional(),
});
export const agendaBlocksListSchema = paginatedResponseSchema("blocks", agendaBlockSchema);

export const agendaBlocksGetRouteSchema = {
  tags: ["Event agenda"],
  summary: "List agenda staffing blocks",
  request: { params: eventSlugParamsSchema, query: agendaBlocksQuerySchema },
  responses: {
    ...ok("Agenda staffing blocks", agendaBlocksListSchema),
    ...authErrors({ badRequest: "Invalid staffing block query", notFound: "Event not found" }),
  },
  ...requiresPermissions("agenda:read"),
};
