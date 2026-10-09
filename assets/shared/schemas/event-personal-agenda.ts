import { participationAvailabilitySchema } from "./event-participation-availability";
import { timeZoneSchema } from "./event-series";
import { requiresSession } from "./route-contract";
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { booleanQueryFlagSchema, utcInstantSchema, eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { sessionParticipationStatusSchema } from "./event-participation-scanning";
import { agendaAdmissionPolicySchema, agendaSnapshotSchema } from "./event-agenda";
export const personalAgendaQuerySchema = listQuerySchema(["title", "startAt"] as const).extend({
  status: sessionParticipationStatusSchema.optional(),
  occurrenceId: databaseIdSchema.optional(),
  /** Only scheduled sessions still running or ahead at this instant (ending after it). */
  from: utcInstantSchema.optional(),
  /** Only sessions on the reader's own agenda: starred, or a place held, awaiting approval or waitlisted. */
  mine: booleanQueryFlagSchema.optional(),
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
  admissionPolicy: agendaAdmissionPolicySchema,
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
/** The viewer's own agenda marks; canceled or unsaved rows are not on their agenda. */
export const personalAgendaMarkSchema = z.object({
  id: databaseIdSchema,
  saved: z.boolean(),
  status: z.enum(["reserved", "approval_pending", "waitlisted"]).nullable(),
});
/** The approved public agenda projection with the viewer's marks; `agenda` is null before the first approval. */
export const personalAgendaProgramResponseSchema = z.object({
  agenda: agendaSnapshotSchema.nullable(),
  marks: z.array(personalAgendaMarkSchema),
});
export const personalAgendaProgramRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Read the published agenda with your personal agenda marks",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Published agenda and personal marks",
      content: { "application/json": { schema: personalAgendaProgramResponseSchema } },
    },
    "401": jsonErrorResponse("Sign in required"),
    "404": jsonErrorResponse("Event not found or not visible"),
  },
};
