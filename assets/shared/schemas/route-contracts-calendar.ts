import { z } from "zod";
import { calendarRsvpIngestSchema } from "./calendar-rsvp";
import { jsonResponse, requiredJsonBody } from "./openapi";
import { publicOperation } from "./route-contract";

export const calendarRsvpSignatureHeadersSchema = z.object({
  "x-pkic-timestamp": z.string().regex(/^\d+$/),
  "x-pkic-signature": z.string().regex(/^[a-f0-9]{64}$/i),
});

export const calendarRsvpResponseSchema = z.object({ processed: z.literal(1) });

export const calendarRsvpPostRouteSchema = {
  ...publicOperation(),
  tags: ["Calendar"],
  summary: "Ingest a signed calendar RSVP event",
  description: "Service-to-service calendar integration protected by a timestamped HMAC signature.",
  request: {
    headers: calendarRsvpSignatureHeadersSchema,
    body: requiredJsonBody(calendarRsvpIngestSchema),
  },
  responses: {
    "200": jsonResponse("RSVP event ingested successfully.", calendarRsvpResponseSchema),
    "400": { description: "Invalid calendar RSVP payload." },
    "401": { description: "Missing, invalid, or expired request signature." },
    "404": { description: "Registration referenced by the calendar UID was not found." },
  },
};
