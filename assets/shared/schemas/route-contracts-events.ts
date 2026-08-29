import { eventSlugParamsSchema, jsonErrorResponse, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
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
import {
  eventTeamListQuerySchema,
  eventTeamRoleCreateResponseSchema,
  eventTeamRoleCreateSchema,
  eventTeamRolesResponseSchema,
} from "./event-team";
import { eventImportResponseSchema, eventImportSchema } from "./event-imports";
import { eventPromotersListQuerySchema, eventPromotersListResponseSchema } from "./event-promoters";
import { eventPresentationArchiveQuerySchema } from "./event-presentations";
import { eventAnalyticsResponseSchema } from "./event-analytics";
import { eventProposalsListQuerySchema, eventProposalsResponseSchema } from "./event-proposals";

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

export const eventImportCreateRouteSchema = {
  tags: ["Events"],
  summary: "Import an event definition",
  description:
    "Creates or updates the event and its configured terms from an external generator. The generating system is named by the request body rather than the route. Requires a live user-backed event write permission, which is re-evaluated inside the same D1 batch as the writes.",
  request: {
    body: { content: { "application/json": { schema: eventImportSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Event imported.",
      content: { "application/json": { schema: eventImportResponseSchema } },
    },
    "400": jsonErrorResponse("Invalid event import payload."),
    "401": jsonErrorResponse("Authentication required."),
    "403": jsonErrorResponse("Insufficient permission to import events."),
    "409": jsonErrorResponse("The event changed concurrently, or it is not owned by this import source."),
  },
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

export const eventTeamRolesListRouteSchema = {
  tags: ["Events"],
  summary: "List event team roles",
  description: "Searches, sorts, and paginates unrevoked role assignments for one event in D1.",
  request: { params: eventSlugParamsSchema, query: eventTeamListQuerySchema },
  responses: {
    "200": {
      description: "Event team role assignments.",
      content: { "application/json": { schema: eventTeamRolesResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated user session is required."),
    "403": jsonErrorResponse("Event management permission is required."),
    "404": jsonErrorResponse("Event not found."),
  },
  "x-pkic-auth": { required: true, scopes: ["events:manage"] },
};

export const eventTeamRoleCreateRouteSchema = {
  tags: ["Events"],
  summary: "Assign an event team role",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventTeamRoleCreateSchema } } },
  },
  responses: {
    "201": {
      description: "Event team role assigned.",
      content: { "application/json": { schema: eventTeamRoleCreateResponseSchema } },
    },
    "400": jsonErrorResponse("Invalid event team role payload."),
    "401": jsonErrorResponse("An authenticated user session is required."),
    "403": jsonErrorResponse("Event management permission is required."),
    "404": jsonErrorResponse("Event not found."),
    "409": jsonErrorResponse("The identity, role assignment, or authorization changed."),
  },
  "x-pkic-auth": { required: true, scopes: ["events:manage"] },
};

export const eventTeamRoleDeleteRouteSchema = {
  tags: ["Events"],
  summary: "Revoke an event team role",
  request: {
    params: eventSlugParamsSchema.extend({ roleAssignmentId: databaseIdSchema }),
  },
  responses: {
    "200": {
      description: "Event team role revoked.",
      content: { "application/json": { schema: successResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated user session is required."),
    "403": jsonErrorResponse("Event management permission is required."),
    "404": jsonErrorResponse("Event or role assignment not found."),
    "409": jsonErrorResponse("The role assignment or authorization changed."),
  },
  "x-pkic-auth": { required: true, scopes: ["events:manage"] },
};

export const eventPromotersListRouteSchema = {
  tags: ["Events"],
  summary: "List event promoters or referral codes",
  description: "Searches, sorts, and paginates promotion activity for one event in D1.",
  request: {
    params: eventSlugParamsSchema,
    query: eventPromotersListQuerySchema,
  },
  responses: {
    "200": {
      description: "Promotion activity page.",
      content: { "application/json": { schema: eventPromotersListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated user session is required."),
    "403": jsonErrorResponse("Event read permission is required."),
    "404": jsonErrorResponse("Event not found."),
  },
  "x-pkic-auth": { required: true, scopes: ["events:read"] },
};

export const eventPresentationArchiveRouteSchema = {
  tags: ["Events"],
  summary: "Download an event presentation archive",
  request: { params: eventSlugParamsSchema, query: eventPresentationArchiveQuerySchema },
  responses: {
    "200": { description: "ZIP archive of current presentations, or every retained version when versions=all." },
    "401": jsonErrorResponse("An authenticated user session is required."),
    "403": jsonErrorResponse("Proposal read permission is required."),
    "404": jsonErrorResponse("Event or presentations not found."),
    "503": jsonErrorResponse("Presentation storage is not configured."),
  },
  "x-pkic-auth": { required: true, scopes: ["proposals:read"] },
};

export const eventAnalyticsRouteSchema = {
  tags: ["Events"],
  summary: "Get event analytics",
  description:
    "Returns event-scoped operational analytics with live event read permission. Proposal totals are included only when the caller also has proposal read permission for this event.",
  request: { params: eventSlugParamsSchema },
  responses: {
    "200": {
      description: "Registration, attendance, waitlist, invitation, RSVP, and permitted proposal analytics.",
      content: { "application/json": { schema: eventAnalyticsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated user session is required."),
    "403": jsonErrorResponse("Event read permission is required."),
    "404": jsonErrorResponse("Event not found."),
  },
  "x-pkic-auth": { required: true, scopes: ["events:read"] },
};

export const eventProposalsListRouteSchema = {
  tags: ["Event proposals"],
  summary: "List event proposals",
  description:
    "Searches, filters, sorts, counts, and paginates proposals in D1 for a caller with live proposal read permission for this event. Set archived=true to select archived records instead of active records.",
  request: { params: eventSlugParamsSchema, query: eventProposalsListQuerySchema },
  responses: {
    "200": {
      description: "Event proposals visible to the authenticated actor.",
      content: { "application/json": { schema: eventProposalsResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated user session is required."),
    "403": jsonErrorResponse("Proposal read permission is required for this event."),
    "404": jsonErrorResponse("Event not found."),
  },
  "x-pkic-auth": { required: true, scopes: ["proposals:read"] },
  "x-pkic-mcp": { expose: true, readonly: true },
};
