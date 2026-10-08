import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import { requiresSession } from "./route-contract";
export const sessionInvitationRequestSchema = z
  .object({
    userId: databaseIdSchema,
    roomId: databaseIdSchema.nullable().optional(),
    attendanceMode: z.enum(["physical", "remote"]),
    action: z.enum(["invite", "add", "revoke"]),
    reasonCode: z.enum(["organizer_invitation", "speaker_invitation", "registration_correction"]),
  })
  .strict();
export const sessionInvitationResponseSchema = z.object({ invited: z.boolean() }).strict();
export const sessionDelegationRequestSchema = z.object({ userId: databaseIdSchema, enabled: z.boolean() }).strict();
export const sessionInvitationRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Invite an attendee to your authorized session",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: sessionInvitationRequestSchema } } },
  },
  responses: {
    "200": {
      description: "Invitation state",
      content: { "application/json": { schema: sessionInvitationResponseSchema } },
    },
    "403": jsonErrorResponse("Session management required"),
  },
};
export const sessionDelegationRouteSchema = {
  ...sessionInvitationRouteSchema,
  summary: "Delegate participant management to an assigned speaker",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }),
    body: { required: true, content: { "application/json": { schema: sessionDelegationRequestSchema } } },
  },
  responses: {
    "200": {
      description: "Delegation state",
      content: { "application/json": { schema: z.object({ enabled: z.boolean() }) } },
    },
    "403": jsonErrorResponse("Organizer management required"),
  },
};
import { badgeAttendeeQuerySchema, badgeAttendeesResponseSchema } from "./route-contracts-event-badges";
import { scannerTargetQuerySchema, scannerTargetsResponseSchema } from "./event-participation-scanning";
export const sessionInviteesRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Search attendees for an authorized session invitation",
  request: {
    params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }),
    query: badgeAttendeeQuerySchema.extend({ q: z.string().trim().min(2).max(200) }),
  },
  responses: {
    "200": {
      description: "Attendee choices",
      content: { "application/json": { schema: badgeAttendeesResponseSchema } },
    },
  },
};
export const managedSessionsRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "List the sessions you are delegated to manage",
  request: { params: eventSlugParamsSchema, query: scannerTargetQuerySchema },
  responses: {
    "200": {
      description: "Assigned delegated sessions",
      content: { "application/json": { schema: scannerTargetsResponseSchema } },
    },
  },
};
export const sessionManagementInfoSchema = z
  .object({
    canDelegate: z.boolean(),
    rooms: z.array(z.object({ id: databaseIdSchema, name: z.string() })).default([]),
    speakers: z.array(z.object({ userId: databaseIdSchema, displayName: z.string() })),
  })
  .strict();
export const sessionManagementInfoRouteSchema = {
  ...requiresSession(),
  tags: ["Events"],
  summary: "Read your session management authority",
  request: { params: eventSlugParamsSchema.extend({ occurrenceId: databaseIdSchema }) },
  responses: {
    "200": {
      description: "Session management controls",
      content: { "application/json": { schema: sessionManagementInfoSchema } },
    },
  },
};
