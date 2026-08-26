import { z } from "zod";
import { eventIdSchema, frontendPathPattern, jsonErrorResponse } from "./api-common";
import { eventRegistrationsListResponseSchema, eventRegistrationsQuerySchema } from "./event-registrations";
import { eventCreateSchema, eventProfileCatalogResponseSchema, eventSettingsSchema } from "./event-management";
import {
  eventProfileKeySchema,
  eventRegistrationPolicySchema,
  eventSourceModeSchema,
  standaloneEventProfileKeySchema,
} from "./event-series";
import { groupIdSchema, groupReferenceParamsSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { attendeeRegistrationParticipationSchema, registrationSubmissionResponseSchema } from "./registration";
import { eventGroupGrantSchemas } from "./resource-grants";

export const GROUP_EVENTS_SORT_COLUMNS = ["name", "starts_at", "next_occurrence_at", "created_at"] as const;

export const groupEventsListQuerySchema = listQuerySchema(GROUP_EVENTS_SORT_COLUMNS).extend({
  profileKey: eventProfileKeySchema.optional(),
  registrationPolicy: eventRegistrationPolicySchema.optional(),
  sourceMode: eventSourceModeSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export type GroupEventsListQuery = z.infer<typeof groupEventsListQuerySchema>;

export const groupEventSchema = z.object({
  id: eventIdSchema,
  ownerGroupId: groupIdSchema,
  seriesId: databaseIdSchema.nullable(),
  slug: z.string(),
  basePath: z.string().trim().regex(frontendPathPattern).max(300).nullable(),
  name: z.string(),
  timezone: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  profileKey: eventProfileKeySchema.nullable(),
  sourceMode: eventSourceModeSchema.nullable(),
  registrationPolicy: eventRegistrationPolicySchema,
  location: z.string().nullable(),
  links: linksSchema,
  nextOccurrenceAt: z.string().nullable(),
  updatedAt: z.string(),
  capabilities: z.array(eventGroupGrantSchemas.capabilitySchema).max(eventGroupGrantSchemas.capabilities.length),
});
export type GroupEvent = z.infer<typeof groupEventSchema>;

export const groupEventsListResponseSchema = paginatedResponseSchema("events", groupEventSchema);
export const groupEventDetailResponseSchema = z.object({ event: groupEventSchema });

export const groupEventProfilesRouteSchema = {
  tags: ["Groups"],
  summary: "List active event profiles available to a group manager",
  description:
    "Returns the active D1-backed event profile catalog. Meeting profiles are intentionally marked series-only.",
  request: { params: groupReferenceParamsSchema },
  responses: {
    "200": {
      description: "Active event profiles and their portal creation eligibility.",
      content: { "application/json": { schema: eventProfileCatalogResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Effective group management permission is required."),
    "404": jsonErrorResponse("Group not found or unavailable to this identity."),
  },
};

const groupEventParamsSchema = groupReferenceParamsSchema.extend({ eventId: eventIdSchema });

/** A portal-managed event always has the selected group as its owner. */
export const groupEventCreateSchema = eventCreateSchema
  .omit({
    registrationMode: true,
    venue: true,
    virtualUrl: true,
  })
  .extend({
    profileKey: standaloneEventProfileKeySchema,
    registrationPolicy: z.literal("no_registration").default("no_registration"),
    location: eventSettingsSchema.shape.location,
    links: linksSchema.optional(),
  });
export type GroupEventCreateInput = z.infer<typeof groupEventCreateSchema>;

/** Optimistic concurrency keeps two group managers from silently overwriting each other. */
export const groupEventSettingsUpdateSchema = eventSettingsSchema
  .omit({
    registrationMode: true,
    venue: true,
    virtualUrl: true,
  })
  .extend({
    links: linksSchema.optional(),
    expectedUpdatedAt: z.iso.datetime(),
  });
export type GroupEventSettingsUpdateInput = z.infer<typeof groupEventSettingsUpdateSchema>;

export const groupEventsListRouteSchema = {
  tags: ["Groups"],
  summary: "List events available through a group",
  description: "Access filtering, search, sorting, counting, and pagination are executed in D1.",
  request: { params: groupReferenceParamsSchema, query: groupEventsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of group-owned and explicitly shared events.",
      content: { "application/json": { schema: groupEventsListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("Group not found or not visible."),
  },
};

export const groupEventDetailRouteSchema = {
  tags: ["Groups"],
  summary: "Get one event available through a group",
  request: { params: groupEventParamsSchema },
  responses: {
    "200": {
      description: "The capability-filtered event projection.",
      content: { "application/json": { schema: groupEventDetailResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
  },
};

export const groupEventCreateRouteSchema = {
  tags: ["Groups"],
  summary: "Create a group-owned event",
  description: "Creates a portal-managed event owned by the selected group.",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupEventCreateSchema } } },
  },
  responses: {
    "201": {
      description: "Event created.",
      content: { "application/json": { schema: groupEventDetailResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Effective group management permission is required."),
    "409": jsonErrorResponse("The group state or event slug changed concurrently."),
  },
};

export const groupEventSettingsUpdateRouteSchema = {
  tags: ["Groups"],
  summary: "Update a group event's settings",
  description: "Updates one group-owned or explicitly managed event with an optimistic revision check.",
  request: {
    params: groupEventParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupEventSettingsUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Event settings updated.",
      content: { "application/json": { schema: groupEventDetailResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event management access is required."),
    "409": jsonErrorResponse("The event or management authority changed; reload and retry."),
  },
};

/** Reuses the canonical, bounded attendee list and response projection. */
export const groupEventRegistrationsListRouteSchema = {
  tags: ["Groups"],
  summary: "List group event attendees",
  description: "Filtering, search, sorting, statistics, and pagination are executed in D1.",
  request: { params: groupEventParamsSchema, query: eventRegistrationsQuerySchema },
  responses: {
    "200": {
      description: "A bounded attendee page for an event the selected group may manage.",
      content: { "application/json": { schema: eventRegistrationsListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "403": jsonErrorResponse("Event attendance-management access is required."),
    "404": jsonErrorResponse("The event is not available through this group."),
  },
};

export const groupEventRegistrationCreateRouteSchema = {
  tags: ["Groups"],
  summary: "Register the authenticated user for a group event",
  description:
    "Uses the verified session identity and the canonical event-registration workflow; submitted identity fields are not accepted.",
  request: {
    params: groupEventParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: attendeeRegistrationParticipationSchema } },
    },
  },
  responses: {
    "200": {
      description: "Authenticated registration completed.",
      content: { "application/json": { schema: registrationSubmissionResponseSchema } },
    },
    "403": jsonErrorResponse("The event does not permit registration through this group."),
    "404": jsonErrorResponse("The event is not available through this group."),
    "409": jsonErrorResponse("Registration state or capacity changed concurrently."),
    "422": jsonErrorResponse("The profile, answers, attendance, or consent is incomplete."),
  },
};
