import { z } from "zod";
import { eventIdSchema, normalizedEmailSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/** Enumeration-safe request for a sponsor-bound portal sign-in capability. */
export const sponsorAccessLinkRequestSchema = z.object({
  email: normalizedEmailSchema,
  eventSlug: eventIdSchema,
});

/** Live sponsor capacity projected into the canonical user session. */
export const sponsorCapacitySchema = z.object({
  sponsorId: databaseIdSchema,
  eventId: databaseIdSchema,
  eventSlug: eventIdSchema,
  eventName: z.string().nullable(),
  tier: z.string(),
  contactEmail: z.email(),
});
export type SponsorCapacity = z.infer<typeof sponsorCapacitySchema>;

export const sponsorAccessLinkCreateRouteSchema = {
  tags: ["Sponsors"],
  summary: "Request a sponsor access link",
  description:
    "Always returns success regardless of whether the email and event match an active sponsorship, preventing sponsorship enumeration.",
  request: {
    body: { content: { "application/json": { schema: sponsorAccessLinkRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Access-link request accepted.",
      content: { "application/json": { schema: successResponseSchema } },
    },
  },
};

export const sponsorAttendeeSchema = z.object({
  registrationId: databaseIdSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.email().nullable(),
  organizationName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  attendanceType: z.string().nullable(),
});

export const sponsorAttendeesParamsSchema = z.object({
  id: databaseIdSchema,
  eventId: eventIdSchema,
});

export const sponsorAttendeeFormatSchema = z.enum(["json", "csv"]);
export const sponsorAttendeesListQuerySchema = listQuerySchema(
  ["name", "email", "organizationName", "attendanceType"] as const,
  { limit: 100 },
).extend({ format: sponsorAttendeeFormatSchema.default("json") });
export type SponsorAttendeesListQuery = z.infer<typeof sponsorAttendeesListQuerySchema>;
export const sponsorAttendeesListResponseSchema = paginatedResponseSchema("attendees", sponsorAttendeeSchema);
export type SponsorAttendee = z.infer<typeof sponsorAttendeeSchema>;

export const sponsorAttendeesListRouteSchema = {
  tags: ["Sponsors"],
  summary: "List consenting attendees for a sponsored event",
  description:
    "Returns only registered attendees who accepted the sponsor-data-sharing term. The authenticated user must have a live sponsor capacity matching both path resources and a tier with attendee-data access.",
  request: { params: sponsorAttendeesParamsSchema, query: sponsorAttendeesListQuerySchema },
  responses: {
    "200": {
      description: "Consenting attendees as JSON, or as a bounded CSV representation when format=csv.",
      content: {
        "application/json": { schema: sponsorAttendeesListResponseSchema },
        "text/csv": { schema: z.string() },
      },
    },
    "403": {
      description: "No live sponsor capacity matches the requested sponsorship/event, or its tier is ineligible.",
    },
  },
};
