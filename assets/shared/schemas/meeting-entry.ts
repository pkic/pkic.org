import { protectsPublicAction } from "./abuse-protection";
/**
 * Meeting-entry contracts: the occurrence-owned landing, intentional join
 * confirmation, and the mailbox verification that turns an invited guest into
 * a browser-bound session. Series, occurrence, guest, and attendance
 * management live in `event-series.ts`.
 */
import { z } from "zod";
import { jsonErrorResponse, tokenSchema, trimmedString, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { publicOperation, requiresSession } from "./route-contract";
import { httpsCapabilityUrlSchema } from "./urls";

/** Selects one verified personal meeting identity without making the URL a credential. */
export const PERSONAL_MEETING_LINK_HEADER = "x-meeting-personal-link";

export const meetingTermAcceptanceSchema = z.object({
  termId: databaseIdSchema,
  version: trimmedString(1, 64),
});
export const meetingJoinConfirmSchema = z
  .object({
    landingRevision: z.string().regex(/^[a-f0-9]{64}$/),
    acceptedTerms: z.array(meetingTermAcceptanceSchema).max(20),
    intentionalJoin: z.literal(true),
  })
  .strict();
export const meetingJoinOccurrenceSchema = z.object({
  id: databaseIdSchema,
  seriesId: databaseIdSchema,
  eventName: z.string(),
  startsAt: utcInstantSchema,
  endsAt: utcInstantSchema,
  location: z.string().nullable(),
});
export const meetingJoinTermSchema = z.object({
  id: databaseIdSchema,
  key: z.string(),
  version: z.string(),
  displayText: z.string(),
  required: z.boolean(),
  accepted: z.boolean(),
});
export const meetingJoinLandingSchema = z.object({
  occurrence: meetingJoinOccurrenceSchema,
  name: z.string(),
  affiliation: z.string().nullable(),
  terms: z.array(meetingJoinTermSchema),
  landingRevision: z.string().regex(/^[a-f0-9]{64}$/),
});
export type MeetingJoinLanding = z.infer<typeof meetingJoinLandingSchema>;
export const meetingJoinResponseSchema = z.object({
  confirmationId: databaseIdSchema,
  confirmedAt: z.string(),
  redirectUrl: httpsCapabilityUrlSchema,
});

export const meetingInvitationVerificationCreateSchema = z.object({
  token: tokenSchema,
});
export const meetingPersonalLinkResolveSchema = z.object({ token: tokenSchema });
export const meetingPersonalLinkResolveResponseSchema = z.object({
  occurrenceId: databaseIdSchema,
  seriesId: databaseIdSchema,
  eventName: z.string(),
  startsAt: utcInstantSchema,
  name: z.string(),
});
export const meetingPersonalLinkSessionResponseSchema = z.object({
  status: z.enum(["ready", "verify"]),
  verification: z.enum(["member", "guest"]),
  occurrenceId: databaseIdSchema,
  eventName: z.string(),
  name: z.string(),
});
export const meetingInvitationVerificationCreateResponseSchema = z.object({
  verificationId: databaseIdSchema,
  expiresAt: utcInstantSchema,
});
export const meetingInvitationVerificationUpdateSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-HJ-NP-Z2-9]{8}$/),
});
export const meetingInvitationVerificationUpdateResponseSchema = z.object({
  occurrenceId: databaseIdSchema,
  expiresAt: utcInstantSchema,
});

export const meetingJoinOccurrenceParamsSchema = z.object({ occurrenceId: databaseIdSchema });
export const meetingInvitationVerificationParamsSchema = meetingJoinOccurrenceParamsSchema.extend({
  verificationId: databaseIdSchema,
});

export const meetingPersonalLinkResolveRouteSchema = {
  ...publicOperation(),
  tags: ["Meetings"],
  summary: "Resolve an invited attendee's personal meeting link without authenticating the browser",
  request: { body: { required: true, content: { "application/json": { schema: meetingPersonalLinkResolveSchema } } } },
  responses: {
    "200": {
      description: "Minimal personal meeting preview.",
      content: { "application/json": { schema: meetingPersonalLinkResolveResponseSchema } },
    },
    "404": jsonErrorResponse("The link is invalid or no eligible upcoming meeting is available."),
  },
};
export const meetingPersonalLinkSessionRouteSchema = {
  ...publicOperation(),
  tags: ["Meetings"],
  summary: "Use verified attendee identity to establish a meeting-only browser session",
  request: {
    params: meetingJoinOccurrenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: meetingPersonalLinkResolveSchema } } },
  },
  responses: {
    "200": {
      description: "Meeting-only session or verification requirement.",
      content: { "application/json": { schema: meetingPersonalLinkSessionResponseSchema } },
    },
    "404": jsonErrorResponse("The link is invalid or no longer eligible."),
  },
};
export const meetingPersonalLinkSessionDeleteRouteSchema = {
  ...publicOperation(),
  tags: ["Meetings"],
  summary: "Forget this browser's meeting-only session",
  request: { params: meetingJoinOccurrenceParamsSchema },
  responses: { "204": { description: "Meeting-only browser session revoked." } },
};
export const meetingPersonalLinkVerificationRouteSchema = {
  ...protectsPublicAction("meeting_verification", "events:manage"),
  ...publicOperation(),
  tags: ["Meetings"],
  summary: "Email a browser challenge to the guest named by a personal meeting link",
  request: {
    params: meetingJoinOccurrenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: meetingPersonalLinkResolveSchema } } },
  },
  responses: {
    "202": {
      description: "Verification code sent.",
      content: { "application/json": { schema: meetingInvitationVerificationCreateResponseSchema } },
    },
    "404": jsonErrorResponse("The guest link is invalid or no longer eligible."),
    "429": jsonErrorResponse("A verification code was requested too recently."),
  },
};

export const meetingJoinLandingRouteSchema = {
  ...requiresSession(),
  tags: ["Meetings"],
  summary: "Inspect a meeting occurrence through the authenticated attendee identity",
  request: { params: meetingJoinOccurrenceParamsSchema },
  responses: {
    "200": {
      description: "Minimal occurrence, authoritative identity, affiliation, and current terms.",
      content: { "application/json": { schema: meetingJoinLandingSchema } },
    },
    "401": jsonErrorResponse("An authenticated member or verified guest session is required."),
    "403": jsonErrorResponse("The authenticated attendee is not eligible for this occurrence."),
  },
};
export const meetingJoinConfirmRouteSchema = {
  ...requiresSession(),
  tags: ["Meetings"],
  summary: "Intentionally confirm meeting entry and obtain the provider redirect",
  request: {
    params: meetingJoinOccurrenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: meetingJoinConfirmSchema } } },
  },
  responses: {
    "200": {
      description: "Occurrence entry recorded and provider redirect returned.",
      content: { "application/json": { schema: meetingJoinResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated member or verified guest session is required."),
    "403": jsonErrorResponse("The authenticated attendee is not eligible for this occurrence."),
    "409": jsonErrorResponse("The identity, terms, meeting state, or exact session changed before commit."),
  },
};

export const meetingInvitationVerificationCreateRouteSchema = {
  ...protectsPublicAction("meeting_verification", "events:manage"),
  ...publicOperation(),
  tags: ["Meetings"],
  summary: "Start browser-bound verification for an invited meeting guest",
  request: {
    params: meetingJoinOccurrenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: meetingInvitationVerificationCreateSchema } } },
  },
  responses: {
    "202": {
      description: "A one-time verification code was sent to the invited address.",
      content: { "application/json": { schema: meetingInvitationVerificationCreateResponseSchema } },
    },
    "404": jsonErrorResponse("The invitation is invalid, expired, or no longer eligible."),
    "429": jsonErrorResponse("A verification code was requested too recently."),
    "503": jsonErrorResponse("Verification is temporarily unavailable because rate limiting could not be enforced."),
  },
};

export const meetingInvitationVerificationUpdateRouteSchema = {
  ...publicOperation(),
  tags: ["Meetings"],
  summary: "Exchange a mailbox code and browser challenge for a guest session",
  request: {
    params: meetingInvitationVerificationParamsSchema,
    body: { required: true, content: { "application/json": { schema: meetingInvitationVerificationUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Guest session established.",
      content: { "application/json": { schema: meetingInvitationVerificationUpdateResponseSchema } },
    },
    "401": jsonErrorResponse("The code or browser challenge is invalid."),
    "429": jsonErrorResponse("Too many verification attempts were made from this client."),
    "409": jsonErrorResponse("The challenge was already used."),
    "410": jsonErrorResponse("The challenge or invitation expired."),
    "503": jsonErrorResponse("Verification is temporarily unavailable because rate limiting could not be enforced."),
  },
};
