import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import {
  adminCreateEventSchema,
  adminBulkAttendeeInvitesSchema,
  adminBulkInviteResponseSchema,
  adminBulkSpeakerInvitesSchema,
  adminEventCreateResponseSchema,
  adminEventPermissionSchema,
  adminEventTeamListQuerySchema,
  adminEventTeamListResponseSchema,
  adminEventTeamPermissionCreateResponseSchema,
  adminEventSettingsSchema,
  adminEventSyncSchema,
  adminEventDetailResponseSchema,
  adminEventUpdateResponseSchema,
  adminWaitlistPromotionResponseSchema,
} from "./admin-events";
import { eventDaysResponseSchema } from "./event-configuration";
import { adminEventStatsResponseSchema } from "./admin-analytics";
import { databaseIdSchema } from "./identifiers";
import { z } from "zod";

const adminEventSyncEventSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  source_path: z.string().nullable(),
  base_path: z.string().nullable(),
  capacity_in_person: z.number().nullable(),
  registration_mode: z.string(),
  invite_limit_attendee: z.number(),
  invite_limit_speaker_nomination: z.number(),
  settings_json: z.string(),
});

export const adminEventSyncResponseSchema = successResponseSchema.extend({
  event: adminEventSyncEventSchema,
});

export const adminEventSyncRouteSchema = {
  tags: ["Admin events"],
  summary: "Synchronize an event from Hugo",
  description: "Creates or updates an event and its configured terms from the Hugo event source.",
  request: {
    body: { content: { "application/json": { schema: adminEventSyncSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Event synchronized.",
      content: { "application/json": { schema: adminEventSyncResponseSchema } },
    },
    "400": { description: "Invalid event synchronization payload." },
    "401": { description: "Admin authorization required." },
    "403": { description: "Insufficient permission to synchronize events." },
  },
};

export const adminEventSettingsPatchRouteSchema = {
  tags: ["Admin events"],
  summary: "Update event settings",
  description: "Updates the event's dedicated settings and its extensible custom settings.",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: adminEventSettingsSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Event settings updated.",
      content: { "application/json": { schema: adminEventUpdateResponseSchema } },
    },
    "400": { description: "Invalid event settings payload." },
    "401": { description: "Admin authorization required." },
    "404": { description: "Event not found." },
  },
};

export const adminEventTeamPermissionDeleteRouteSchema = {
  tags: ["Admin events"],
  summary: "Revoke an event-team permission",
  request: {
    params: eventSlugParamsSchema.extend({ permId: databaseIdSchema }),
  },
  responses: {
    "200": {
      description: "Permission revoked.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "403": { description: "Insufficient permission to manage this event." },
    "404": { description: "Event or permission grant not found." },
  },
};

export const adminEventDetailRouteSchema = {
  tags: ["Admin events"],
  summary: "Get event details",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Event details and settings.",
      content: { "application/json": { schema: adminEventDetailResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Event not found." },
  },
};

export const adminEventStatsRouteSchema = {
  tags: ["Admin events"],
  summary: "Get event statistics",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Event registration, attendance, waitlist, invitation, proposal, and RSVP statistics.",
      content: { "application/json": { schema: adminEventStatsResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "404": { description: "Event not found." },
  },
};

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
      content: { "application/json": { schema: eventDaysResponseSchema } },
    },
    "401": { description: "Admin authorization required." },
    "403": { description: "Insufficient permission to read this event." },
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
