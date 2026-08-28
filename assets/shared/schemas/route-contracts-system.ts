import { z } from "zod";
import { adminEmailOutboxQuerySchema } from "./admin-email-outbox";
import { adminEmailOutboxResponseSchema } from "./admin-email-outbox";
import { internalCalendarRsvpIngestSchema } from "./calendar-rsvp";
import { jsonResponse, requiredJsonBody } from "./openapi";

export const internalCalendarRsvpResponseSchema = z.object({ processed: z.literal(1) });

export const internalCalendarRsvpPostRouteSchema = {
  tags: ["Internal", "Calendar"],
  summary: "Ingest a signed calendar RSVP event",
  request: { body: requiredJsonBody(internalCalendarRsvpIngestSchema) },
  responses: {
    "200": jsonResponse("RSVP event ingested successfully.", internalCalendarRsvpResponseSchema),
    "400": { description: "Invalid calendar RSVP payload." },
    "401": { description: "Missing, invalid, or expired request signature." },
    "404": { description: "Registration referenced by the calendar UID was not found." },
  },
};

export const apiRootGetRouteSchema = {
  tags: ["System"],
  summary: "Get API status",
  description: "Returns the API name, version, documentation URL, and current health status.",
  responses: {
    "200": {
      description: "API status metadata.",
      content: {
        "application/json": {
          schema: z.object({
            name: z.string(),
            version: z.string(),
            docs: z.string(),
            status: z.literal("ok"),
          }),
        },
      },
    },
  },
};

export const adminEmailOutboxGetRouteSchema = {
  tags: ["Admin email"],
  summary: "List email outbox messages",
  description:
    "Returns a paginated operational view of queued, sent, failed, bounced, and retryable email outbox rows.",
  request: {
    query: adminEmailOutboxQuerySchema,
  },
  responses: {
    "200": {
      description: "Paginated email outbox rows and aggregate delivery summary.",
      content: { "application/json": { schema: adminEmailOutboxResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
  },
};
