/**
 * Sponsor portal — magic-link auth + attendee data access for event
 * sponsors at a qualifying tier ("Sponsor Portal — Attendee Data
 * Access"). Mirrors member-auth.ts's shape; kept separate because the
 * identity here is a sponsorships.id, not a users.id (see
 * _lib/auth/sponsor-portal.ts's header comment).
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { emailAuthTokenSchema, eventIdSchema, normalizedEmailSchema, successResponseSchema } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const sponsorPortalAuthRequestSchema = z.object({
  email: normalizedEmailSchema,
  // Accepts either the event's internal id or its public slug — resolved
  // server-side against both events.id and events.slug (see
  // _lib/auth/sponsor-portal.ts's queueSponsorPortalSignInCapabilityForEmail), since a
  // sponsor contact re-requesting a link only ever knows the public slug.
  eventId: z.string().trim().min(1),
});

export const sponsorPortalAuthVerifySchema = z.object({
  token: emailAuthTokenSchema,
});

export const sponsorPortalSessionSchema = z.object({
  sponsorshipId: databaseIdSchema,
  eventId: eventIdSchema,
  eventName: z.string().nullable(),
  tier: z.string(),
  contactEmail: z.string(),
});
export type SponsorPortalSession = z.infer<typeof sponsorPortalSessionSchema>;
export const sponsorPortalAuthVerifyResponseSchema = successResponseSchema.extend({
  expiresAt: z.string(),
  sponsorship: sponsorPortalSessionSchema,
});
export type SponsorPortalAuthVerifyResponse = z.infer<typeof sponsorPortalAuthVerifyResponseSchema>;

export const sponsorPortalAuthRequestRouteSchema = {
  tags: ["Sponsor Portal"],
  summary: "Request a sponsor portal sign-in magic link",
  description:
    "Always returns success regardless of whether the email/event matches an active event sponsorship, to avoid leaking sponsorship existence.",
  request: {
    body: { content: { "application/json": { schema: sponsorPortalAuthRequestSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Magic link sent if the email matches an active event sponsorship for this event.",
      content: { "application/json": { schema: successResponseSchema } },
    },
  },
};

export const sponsorPortalAuthVerifyRouteSchema = {
  tags: ["Sponsor Portal"],
  summary: "Verify a sponsor portal magic link and start a session",
  request: {
    body: { content: { "application/json": { schema: sponsorPortalAuthVerifySchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Session established.",
      content: {
        "application/json": {
          schema: sponsorPortalAuthVerifyResponseSchema,
        },
      },
    },
  },
};

export const sponsorPortalAttendeeSchema = z.object({
  registrationId: databaseIdSchema,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  organizationName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  attendanceType: z.string().nullable(),
});

export const sponsorPortalAttendeesEventIdParamsSchema = z.object({ eventId: eventIdSchema });

// P6M-P2-11: this list was fully unbounded — could grow to thousands for a
// large event. Bounded via the shared pagination contract.
export const sponsorPortalAttendeesListQuerySchema = listQuerySchema(
  ["name", "email", "organizationName", "attendanceType"] as const,
  { limit: 100 },
);
export type SponsorPortalAttendeesListQuery = z.infer<typeof sponsorPortalAttendeesListQuerySchema>;
export const sponsorPortalAttendeesListResponseSchema = paginatedResponseSchema(
  "attendees",
  sponsorPortalAttendeeSchema,
);
export type SponsorPortalAttendee = z.infer<typeof sponsorPortalAttendeeSchema>;

export const sponsorPortalAttendeesListRouteSchema = {
  tags: ["Sponsor Portal"],
  summary: "List consenting attendees for a sponsored event",
  description:
    "Only attendees who accepted the sponsor-data-sharing consent term at registration. 403 if this sponsorship's tier is not configured for attendee data access, or the sponsorship has lapsed.",
  request: { params: sponsorPortalAttendeesEventIdParamsSchema, query: sponsorPortalAttendeesListQuerySchema },
  responses: {
    "200": {
      description: "Consenting attendees.",
      content: { "application/json": { schema: sponsorPortalAttendeesListResponseSchema } },
    },
    "403": {
      description:
        "This sponsorship's tier does not have attendee data access, or the event does not match this session.",
    },
  },
};

export const sponsorPortalAttendeesExportRouteSchema = {
  tags: ["Sponsor Portal"],
  summary: "Download consenting attendees as CSV",
  request: { params: sponsorPortalAttendeesEventIdParamsSchema },
  responses: {
    "200": { description: "CSV file." },
    "403": {
      description:
        "This sponsorship's tier does not have attendee data access, or the event does not match this session.",
    },
  },
};
