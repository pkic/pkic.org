import { z } from "zod";
import { agendaRevisionSchema, agendaRoomSchema, agendaSnapshotSchema } from "./event-agenda";
import { eventSlugParamsSchema } from "./api-common";
import { authErrors, ok, requiresPermissions } from "./route-contract";

export const agendaRoomOrderIdsSchema = z
  .array(agendaRoomSchema.shape.id)
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length, "Choose each location once");
export const agendaRoomOrderSchema = agendaRevisionSchema.extend({ roomIds: agendaRoomOrderIdsSchema });
export const agendaRoomOrderRouteSchema = {
  ...requiresPermissions("agenda:write"),
  tags: ["Event agenda"],
  summary: "Set the canonical location column order",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: agendaRoomOrderSchema } } },
  },
  responses: {
    ...ok("Reordered agenda", agendaSnapshotSchema),
    ...authErrors({
      badRequest: "Choose every event location exactly once",
      conflict: "Agenda or event settings changed",
      notFound: "Event not found",
    }),
  },
};
