import { z } from "zod";
import { eventIdSchema, jsonErrorResponse } from "./api-common";
import { eventProfileKeySchema, eventRegistrationPolicySchema, eventSourceModeSchema } from "./event-series";
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
  capabilities: z.array(eventGroupGrantSchemas.capabilitySchema).max(eventGroupGrantSchemas.capabilities.length),
});
export type GroupEvent = z.infer<typeof groupEventSchema>;

export const groupEventsListResponseSchema = paginatedResponseSchema("events", groupEventSchema);
export const groupEventDetailResponseSchema = z.object({ event: groupEventSchema });

const groupEventParamsSchema = groupReferenceParamsSchema.extend({ eventId: eventIdSchema });

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
