import { agendaShiftSchema } from "./event-agenda";
import { eventSlugParamsSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { authErrors, ok, requiresPermissions } from "./route-contract";

export const agendaShiftsQuerySchema = listQuerySchema(["name", "startAt", "endAt"] as const).extend({
  roomId: agendaShiftSchema.shape.roomId.unwrap().optional(),
});
export const agendaShiftsListSchema = paginatedResponseSchema("shifts", agendaShiftSchema);

export const agendaShiftsGetRouteSchema = {
  tags: ["Event agenda"],
  summary: "List agenda staffing shifts",
  request: { params: eventSlugParamsSchema, query: agendaShiftsQuerySchema },
  responses: {
    ...ok("Agenda staffing shifts", agendaShiftsListSchema),
    ...authErrors({ badRequest: "Invalid staffing shift query", notFound: "Event not found" }),
  },
  ...requiresPermissions("agenda:read"),
};
