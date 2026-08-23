import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import {
  adminCreateEventSchema,
  adminBulkAttendeeInvitesSchema,
  adminBulkInviteResponseSchema,
  adminBulkSpeakerInvitesSchema,
  adminEventCreateResponseSchema,
  adminEventDaysReplaceResponseSchema,
  adminEventDaysReplaceSchema,
  adminEventDaysResponseSchema,
  adminEventPermissionSchema,
  adminEventTeamListQuerySchema,
  adminEventTeamListResponseSchema,
  adminEventTeamPermissionCreateResponseSchema,
  adminWaitlistPromotionResponseSchema,
} from "./admin-events";
import { databaseIdSchema } from "./identifiers";

export const adminEventCreateRouteSchema = {
  tags: ["Admin events"],
  summary: "Create an event",
  description: "Creates a new event with a unique slug and its initial registration settings.",
  request: {
    body: { content: { "application/json": { schema: adminCreateEventSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Event created.",
      content: { "application/json": { schema: adminEventCreateResponseSchema } },
    },
    "400": { description: "Invalid event payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "Insufficient permission to create events." },
    "409": { description: "An event with this slug already exists." },
  },
};

export const adminEventDaysGetRouteSchema = {
  tags: ["Admin events"],
  summary: "List configured event days",
  description: "Returns configured event days, attendance options, and server-computed attendance counts.",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Configured event days.",
      content: { "application/json": { schema: adminEventDaysResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "403": { description: "Insufficient permission to read this event." },
    "404": { description: "Event not found." },
  },
};

export const adminEventDaysReplaceRouteSchema = {
  tags: ["Admin events"],
  summary: "Replace configured event days",
  description: "Updates matching days in place and removes only unused days omitted from the new configuration.",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: adminEventDaysReplaceSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Updated event days and any dates that could not be removed.",
      content: { "application/json": { schema: adminEventDaysReplaceResponseSchema } },
    },
    "400": { description: "Invalid event-day payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "Insufficient permission to update this event." },
    "404": { description: "Event not found." },
  },
};

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
