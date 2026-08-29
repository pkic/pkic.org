import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import {
  adminEventCreateResponseSchema,
  adminEventPermissionSchema,
  adminEventTeamListQuerySchema,
  adminEventTeamListResponseSchema,
  adminEventTeamPermissionCreateResponseSchema,
  adminEventSyncSchema,
  adminWaitlistPromotionResponseSchema,
} from "./admin-events";
import { eventCreateSchema } from "./event-management";
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

export const adminEventStatsRouteSchema = {
  tags: ["Admin events"],
  summary: "Get event statistics",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description:
        "Event registration, attendance, waitlist, invitation, and RSVP statistics. Proposal totals are included only when the caller also has proposals:read for this event.",
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
    body: { content: { "application/json": { schema: eventCreateSchema } }, required: true },
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
