import { z } from "zod";
import { booleanQueryFlagSchema, jsonErrorResponse, utcInstantSchema } from "./api-common";
import { personalAgendaSessionSchema } from "./event-personal-agenda";
import { sessionParticipationStatusSchema } from "./event-participation-scanning";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { requiresPermissions } from "./route-contract";
import { eventRegistrationParamsSchema } from "./route-contracts-event-registration-management";

export const registrationSessionsQuerySchema = listQuerySchema(["title", "startAt"] as const)
  .extend({ status: sessionParticipationStatusSchema.optional(), saved: booleanQueryFlagSchema.optional() })
  .strict();

/** Favorites describe interest independently of capacity-backed participation. */
export const registrationSessionSchema = personalAgendaSessionSchema
  .pick({
    id: true,
    publishedRevision: true,
    title: true,
    timeZone: true,
    startAt: true,
    endAt: true,
    visibility: true,
    admissionPolicy: true,
    rooms: true,
    roomId: true,
    saved: true,
    status: true,
    attendanceMode: true,
  })
  .extend({ status: sessionParticipationStatusSchema, createdAt: utcInstantSchema, updatedAt: utcInstantSchema });
export const registrationSessionsResponseSchema = paginatedResponseSchema("sessions", registrationSessionSchema);
export type RegistrationSessionsQuery = z.infer<typeof registrationSessionsQuerySchema>;
export type RegistrationSessionsResponse = z.infer<typeof registrationSessionsResponseSchema>;

export const registrationSessionsRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Event registrations"],
  summary: "List an attendee's saved sessions and participation in the published agenda",
  request: { params: eventRegistrationParamsSchema, query: registrationSessionsQuerySchema },
  responses: {
    "200": {
      description: "Event-owned attendee session intent; no private meeting links or attendance claims.",
      content: { "application/json": { schema: registrationSessionsResponseSchema } },
    },
    "401": jsonErrorResponse("Sign in required"),
    "403": jsonErrorResponse("Event management permission required"),
    "404": jsonErrorResponse("Event registration unavailable"),
    "409": jsonErrorResponse("Event management authorization changed"),
    "410": jsonErrorResponse("Event contact access has expired"),
  },
};
