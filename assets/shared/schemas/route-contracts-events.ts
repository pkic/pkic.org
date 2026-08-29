import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  eventDaysManagementReplaceResponseSchema,
  eventDaysManagementReplaceSchema,
  eventDaysManagementResponseSchema,
} from "./event-configuration";
import {
  eventDetailResponseSchema,
  eventManagementDetailResponseSchema,
  eventSettingsUpdateSchema,
  eventsListQuerySchema,
  eventsListResponseSchema,
} from "./event-management";

export const eventDetailRouteSchema = {
  tags: ["Events"],
  summary: "Get an event",
  description:
    "Returns only the event fields visible to the caller. Management configuration is included only with exact event read permission.",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Event details and current optimistic revision.",
      content: { "application/json": { schema: eventDetailResponseSchema } },
    },
    "401": jsonErrorResponse("The supplied user session is invalid."),
    "404": jsonErrorResponse("Event not found or not visible to this caller."),
  },
  "x-pkic-auth": { required: false },
};

export const eventsListRouteSchema = {
  tags: ["Events"],
  summary: "List visible events",
  description:
    "Searches, filters, counts, and paginates in D1. Rows and fields are limited by the caller's live event audience and permissions.",
  request: { query: eventsListQuerySchema },
  responses: {
    "200": {
      description: "Visible event summaries.",
      content: { "application/json": { schema: eventsListResponseSchema } },
    },
    "401": jsonErrorResponse("The supplied user session is invalid."),
  },
  "x-pkic-auth": { required: false },
};

export const eventSettingsPatchRouteSchema = {
  tags: ["Events"],
  summary: "Update direct event settings",
  description:
    "Updates an ownerless or Hugo/integration event with live permission, ownership, series, and revision guards.",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventSettingsUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Event settings updated.",
      content: { "application/json": { schema: eventManagementDetailResponseSchema } },
    },
    "400": jsonErrorResponse("Invalid event settings payload."),
    "401": jsonErrorResponse("An authenticated user session is required."),
    "403": jsonErrorResponse("Event write permission is required."),
    "404": jsonErrorResponse("Event not found."),
    "409": jsonErrorResponse("The event revision, ownership, series, or write permission changed."),
  },
  "x-pkic-auth": { required: true, scopes: ["events:write"] },
};

export const eventDaysGetRouteSchema = {
  tags: ["Events"],
  summary: "Get configured event days",
  description: "Returns D1-aggregated attendance counts and the current event revision.",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Configured event days and attendance counts.",
      content: { "application/json": { schema: eventDaysManagementResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated user session is required."),
    "403": jsonErrorResponse("Event read permission is required."),
    "404": jsonErrorResponse("Event not found."),
  },
  "x-pkic-auth": { required: true, scopes: ["events:read"] },
};

export const eventDaysPutRouteSchema = {
  tags: ["Events"],
  summary: "Replace direct event days",
  description:
    "Replaces days for an ownerless or Hugo/integration event in one guarded D1 batch with optimistic concurrency.",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventDaysManagementReplaceSchema } } },
  },
  responses: {
    "200": {
      description: "Days replaced and event revision advanced.",
      content: { "application/json": { schema: eventDaysManagementReplaceResponseSchema } },
    },
    "400": jsonErrorResponse("Invalid event-day payload."),
    "401": jsonErrorResponse("An authenticated user session is required."),
    "403": jsonErrorResponse("Event write permission is required."),
    "404": jsonErrorResponse("Event not found."),
    "409": jsonErrorResponse("The event revision, ownership, series, or write permission changed."),
  },
  "x-pkic-auth": { required: true, scopes: ["events:write"] },
};
