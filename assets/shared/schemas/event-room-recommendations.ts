import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { requiresSession } from "./route-contract";
import { agendaEquipmentSchema } from "./event-agenda";
import { sessionDemandCountsSchema } from "./event-session-demand";
const demand = sessionDemandCountsSchema.extend({
  occupied: z.number().int().nonnegative(),
});
export const roomRecommendationsResponseSchema = z.object({
  occurrenceId: databaseIdSchema,
  revision: z.number().int().nonnegative(),
  demand: z.object({ physical: demand, remote: demand }),
  recommendations: z
    .array(
      z.object({
        roomId: databaseIdSchema,
        name: z.string(),
        capacity: z.number().int().nonnegative().nullable(),
        equipment: agendaEquipmentSchema,
        fit: z.enum(["fits", "review", "unavailable"]),
        reasons: z.array(z.string()),
        proposedRoomId: databaseIdSchema,
        proposedAdditionalRoomIds: z.array(databaseIdSchema),
        proposedCapacity: z.number().int().nonnegative().nullable(),
        physicalDemand: z.number().int().nonnegative(),
        newRoomDemand: z.number().int().nonnegative(),
      }),
    )
    .max(200),
});
export const roomRecommendationsRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Review organizer room fit and distinct session demand",
  request: { params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }) },
  responses: {
    "200": {
      description: "Current demand and candidate room constraints",
      content: { "application/json": { schema: roomRecommendationsResponseSchema } },
    },
    "403": jsonErrorResponse("Organizer permission required"),
  },
};
