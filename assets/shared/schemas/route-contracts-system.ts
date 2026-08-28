import { z } from "zod";
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
