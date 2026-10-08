import { z } from "zod";
import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  eventRecordingAcquireSchema,
  eventRecordingAcquisitionSchema,
  eventRecordingSourceBindSchema,
  eventRecordingSourceRefreshSchema,
  eventRecordingSourceSchema,
  eventRecordingSourcesQuerySchema,
  eventRecordingSourcesResponseSchema,
  eventRecordingVersionsQuerySchema,
  eventRecordingVersionsResponseSchema,
} from "./event-recordings";
import { authErrors, ok, requiresPermissions } from "./route-contract";

const recordingSourceParamsSchema = eventSlugParamsSchema.extend({ sourceId: z.uuid() });
const recordingAcquisitionParamsSchema = recordingSourceParamsSchema.extend({ acquisitionId: z.uuid() });
const recordingRouteErrors = authErrors({
  badRequest: "Invalid recording request",
  notFound: "Event or recording not found",
  conflict: "Recording ownership or request changed",
});

export const eventRecordingSourceBindRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Event recordings"],
  summary: "Bind an exactly discovered recording source to an event",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventRecordingSourceBindSchema } } },
  },
  responses: {
    ...ok("Bound recording metadata", eventRecordingSourceSchema),
    ...recordingRouteErrors,
    "422": jsonErrorResponse("Choose an occurrence belonging to this event"),
    "503": jsonErrorResponse("Recording discovery is unavailable"),
  },
};

export const eventRecordingSourcesRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Event recordings"],
  summary: "List event-owned recording sources",
  request: { params: eventSlugParamsSchema, query: eventRecordingSourcesQuerySchema },
  responses: { ...ok("Recording source catalog", eventRecordingSourcesResponseSchema), ...recordingRouteErrors },
};

export const eventRecordingSourceRefreshRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Event recordings"],
  summary: "Refresh metadata for an existing event-owned recording source",
  request: {
    params: recordingSourceParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventRecordingSourceRefreshSchema } } },
  },
  responses: {
    ...ok("Current recording source metadata", eventRecordingSourceSchema),
    ...recordingRouteErrors,
    "503": jsonErrorResponse("Recording metadata is unavailable"),
  },
};

export const eventRecordingVersionsRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Event recordings"],
  summary: "List event-owned recording versions",
  request: { params: eventSlugParamsSchema, query: eventRecordingVersionsQuerySchema },
  responses: { ...ok("Owned recording catalog", eventRecordingVersionsResponseSchema), ...recordingRouteErrors },
};

export const eventRecordingAcquireRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Event recordings"],
  summary: "Request durable acquisition of an event-owned recording source",
  request: {
    params: recordingSourceParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventRecordingAcquireSchema } } },
  },
  responses: { ...ok("Durable recording request", eventRecordingAcquisitionSchema), ...recordingRouteErrors },
};

export const eventRecordingAcquisitionRouteSchema = {
  ...requiresPermissions("events:manage"),
  tags: ["Event recordings"],
  summary: "Read the metadata of an event-owned recording acquisition",
  request: { params: recordingAcquisitionParamsSchema },
  responses: { ...ok("Recording acquisition metadata", eventRecordingAcquisitionSchema), ...recordingRouteErrors },
};
