import { participationAvailabilitySchema } from "./event-participation-availability";
import { timeZoneSchema } from "./event-series";
import { requiresSession } from "./route-contract";
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { utcInstantSchema, eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { sessionParticipationStatusSchema } from "./event-participation-scanning";
export const personalAgendaQuerySchema = listQuerySchema(["title", "startAt"] as const).extend({
  status: sessionParticipationStatusSchema.optional(),
  occurrenceId: databaseIdSchema.optional(),
});
export const personalAgendaSessionSchema = z.object({
  id: databaseIdSchema,
  publishedRevision: z.number().int().nonnegative(),
  title: z.string(),
  onlineAccessAvailable: z.boolean().optional(),
  roomId: databaseIdSchema.nullable().optional(),
  rooms: z.array(z.object({ id: databaseIdSchema, name: z.string() })).default([]),
  timeZone: timeZoneSchema,
  startAt: utcInstantSchema.nullable(),
  endAt: utcInstantSchema.nullable(),
  visibility: z.enum(["public", "private"]).default("public"),
  admissionPolicy: z.enum(["preference", "reservation", "approval"]),
  status: sessionParticipationStatusSchema.nullable(),
  saved: z.boolean().default(false),
  overlapCount: z.number().int().nonnegative().default(0),
  overlaps: z
    .array(z.object({ id: databaseIdSchema, title: z.string(), status: sessionParticipationStatusSchema }))
    .max(5)
    .default([]),
  availability: z.array(participationAvailabilitySchema).max(21).default([]),
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
