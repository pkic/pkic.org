import { z } from "zod";
import { apiErrorPayloadSchema, eventIdSchema } from "./api-common";
import { eventProfileKeySchema, eventRegistrationPolicySchema, eventSourceModeSchema } from "./event-series";
import { groupIdSchema, groupReferenceParamsSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
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
const jsonError = (description: string) => ({
  description,
  content: { "application/json": { schema: apiErrorPayloadSchema } },
});

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
    "401": jsonError("An authenticated portal identity is required."),
    "404": jsonError("Group not found or not visible."),
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
    "401": jsonError("An authenticated portal identity is required."),
    "404": jsonError("The event is not available through this group."),
  },
};
