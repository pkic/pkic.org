import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  eventRecordingDiscoveryQuerySchema,
  eventRecordingDiscoveryResponseSchema,
  eventRecordingMeetingLinkSchema,
  eventRecordingMeetingSchema,
  eventRecordingMeetingsQuerySchema,
  eventRecordingMeetingsResponseSchema,
  eventRecordingProviderMeetingsQuerySchema,
  eventRecordingProviderMeetingsResponseSchema,
} from "./event-recording-discovery";
import { authErrors, ok, requiresPermissions } from "./route-contract";

const errors = {
  ...authErrors({
    badRequest: "Invalid discovery request",
    notFound: "Event or meeting link not found",
    conflict: "Meeting ownership changed",
  }),
  "422": jsonErrorResponse("Choose an occurrence belonging to this event"),
  "503": jsonErrorResponse("Recording discovery is unavailable"),
};
const access = { ...requiresPermissions("events:manage"), tags: ["Event recordings"] };
export const eventRecordingProviderMeetingsRouteSchema = {
  ...access,
  summary: "Discover meetings in the configured recording provider app",
  request: { params: eventSlugParamsSchema, query: eventRecordingProviderMeetingsQuerySchema },
  responses: { ...ok("Provider meeting chooser", eventRecordingProviderMeetingsResponseSchema), ...errors },
};
export const eventRecordingMeetingLinkRouteSchema = {
  ...access,
  summary: "Explicitly link a verified provider meeting to an event",
  request: {
    params: eventSlugParamsSchema,
    body: { required: true, content: { "application/json": { schema: eventRecordingMeetingLinkSchema } } },
  },
  responses: { ...ok("Event recording meeting link", eventRecordingMeetingSchema), ...errors },
};
export const eventRecordingMeetingsRouteSchema = {
  ...access,
  summary: "List provider meetings explicitly linked to this event",
  request: { params: eventSlugParamsSchema, query: eventRecordingMeetingsQuerySchema },
  responses: { ...ok("Event recording meetings", eventRecordingMeetingsResponseSchema), ...errors },
};
export const eventRecordingDiscoveryRouteSchema = {
  ...access,
  summary: "Discover one page of recording metadata in an event-linked provider meeting",
  request: { params: eventSlugParamsSchema, query: eventRecordingDiscoveryQuerySchema },
  responses: { ...ok("Recording metadata chooser", eventRecordingDiscoveryResponseSchema), ...errors },
};
