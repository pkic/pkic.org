import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import {
  adminEventCreateResponseSchema,
  adminEventSyncSchema,
  adminWaitlistPromotionResponseSchema,
} from "./admin-events";
import { eventCreateSchema } from "./event-management";
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
