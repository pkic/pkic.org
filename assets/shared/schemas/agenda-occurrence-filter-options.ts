import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { listFilterOptionsQuerySchema, listFilterOptionsResponseSchema } from "./list-filter-options";
import { requiresPermissions } from "./route-contract";
export const agendaOccurrenceFilterOptionsQuerySchema = listFilterOptionsQuerySchema.extend({
  field: z.enum(["speakerUserId", "track"]),
});
export type AgendaOccurrenceFilterOptionsQuery = z.infer<typeof agendaOccurrenceFilterOptionsQuerySchema>;
export const agendaOccurrenceFilterOptionsRouteSchema = {
  ...requiresPermissions("agenda:read"),
  tags: ["Events"],
  summary: "List actual agenda speaker or track filter choices independently of loaded session rows",
  request: { params: eventSlugParamsSchema, query: agendaOccurrenceFilterOptionsQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of assigned speakers or authored track labels",
      content: { "application/json": { schema: listFilterOptionsResponseSchema } },
    },
    "401": jsonErrorResponse("Authentication required"),
    "403": jsonErrorResponse("Event agenda read permission required"),
  },
};
