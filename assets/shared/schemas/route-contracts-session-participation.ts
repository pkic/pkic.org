import { requiresPermissions, requiresSession } from "./route-contract";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { z } from "zod";
import { sessionBookingsQuerySchema, sessionBookingsResponseSchema } from "./event-participation-reporting";
import { sessionParticipationRequestSchema, sessionParticipationResponseSchema } from "./event-participation-scanning";
export const sessionReviewRequestSchema = z.object({ decision: z.enum(["approve", "reject"]) }).strict();
export const sessionParticipationRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Save a session preference or request a place",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }),
    body: { content: { "application/json": { schema: sessionParticipationRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Participation state",
      content: { "application/json": { schema: sessionParticipationResponseSchema } },
    },
    "401": jsonErrorResponse("Sign in required"),
    "409": jsonErrorResponse("Session participation conflict"),
  },
};
export const sessionReviewRouteSchema = {
  ...sessionParticipationRouteSchema,
  ...requiresPermissions("agenda:write"),
  summary: "Approve or reject a session participation request",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema, userId: databaseIdSchema }),
    body: {
      content: { "application/json": { schema: sessionReviewRequestSchema } },
      required: true,
    },
  },
};
export const sessionBookingsRouteSchema = {
  ...requiresPermissions("agenda:write"),
  tags: ["Events"],
  summary: "List session participation and approval requests",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }),
    query: sessionBookingsQuerySchema,
  },
  responses: {
    "200": {
      description: "Session participants",
      content: { "application/json": { schema: sessionBookingsResponseSchema } },
    },
    "403": jsonErrorResponse("Agenda write permission required"),
  },
};
