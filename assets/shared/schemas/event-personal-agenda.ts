import { requiresSession } from "./route-contract";
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema, eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { sessionParticipationStatusSchema } from "./event-participation-scanning";
export const personalAgendaQuerySchema = listQuerySchema(["title", "startAt"] as const).extend({
  status: sessionParticipationStatusSchema.optional(),
});
export const personalAgendaSessionSchema = z.object({
  id: databaseIdSchema,
  title: z.string(),
  startAt: utcInstantSchema.nullable(),
  endAt: utcInstantSchema.nullable(),
  admissionPolicy: z.enum(["preference", "reservation", "approval"]),
  status: sessionParticipationStatusSchema.nullable(),
  attendanceMode: z.enum(["physical", "remote"]).nullable(),
});
export const personalAgendaResponseSchema = paginatedResponseSchema("sessions", personalAgendaSessionSchema);
export const personalAgendaRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "List sessions and your personal participation",
  request: { params: eventSlugParamsSchema, query: personalAgendaQuerySchema },
  responses: {
    "200": {
      description: "Personal session agenda",
      content: { "application/json": { schema: personalAgendaResponseSchema } },
    },
    "401": jsonErrorResponse("Sign in required"),
  },
};
