import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import {
  adminBulkAttendeeInvitesSchema,
  adminBulkInviteResponseSchema,
  adminBulkSpeakerInvitesSchema,
  adminEventPermissionSchema,
  adminEventTeamListQuerySchema,
  adminEventTeamListResponseSchema,
  adminEventTeamPermissionCreateResponseSchema,
  adminWaitlistPromotionResponseSchema,
} from "./admin-events";
import { databaseIdSchema } from "./identifiers";

export const adminEventTeamListRouteSchema = {
  tags: ["Admin events"],
  summary: "List event-level roles (admin)",
  description: "Paginated, searchable, and sortable event-team role grants.",
  request: { params: eventSlugParamsSchema, query: adminEventTeamListQuerySchema },
  responses: {
    "200": {
      description: "Event-team permissions list.",
      content: { "application/json": { schema: adminEventTeamListResponseSchema } },
    },
  },
};

export const adminEventTeamPermissionCreateRouteSchema = {
  tags: ["Admin events"],
  summary: "Grant an event team permission",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: adminEventPermissionSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Permission granted.",
      content: { "application/json": { schema: adminEventTeamPermissionCreateResponseSchema } },
    },
  },
};

export const adminEventInviteRevokeRouteSchema = {
  tags: ["Admin events"],
  summary: "Revoke an event invitation",
  description: "Revoke a pending invitation before it is accepted.",
  request: {
    params: eventSlugParamsSchema.extend({ inviteId: databaseIdSchema }),
  },
  responses: {
    "200": {
      description: "Invitation revoked.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "404": { description: "Invitation not found for this event." },
    "409": { description: "Invitation is no longer pending." },
  },
};

export const adminBulkAttendeeInvitesRouteSchema = {
  tags: ["Admin events"],
  summary: "Create attendee invites in bulk",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: adminBulkAttendeeInvitesSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Invites processed.",
      content: { "application/json": { schema: adminBulkInviteResponseSchema } },
    },
  },
};

export const adminBulkSpeakerInvitesRouteSchema = {
  ...adminBulkAttendeeInvitesRouteSchema,
  summary: "Create speaker invites in bulk",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: adminBulkSpeakerInvitesSchema } }, required: true },
  },
};

export const adminWaitlistPromotionRouteSchema = {
  tags: ["Admin events"],
  summary: "Promote waitlisted registrations",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Waitlist promotions processed.",
      content: { "application/json": { schema: adminWaitlistPromotionResponseSchema } },
    },
  },
};
