import {
  groupEventInviteResendRouteSchema,
  groupEventInviteRevokeRouteSchema,
  groupEventInvitesListRouteSchema,
  groupEventParamsSchema,
} from "./group-events";
import {
  eventBulkAttendeeInvitesPreviewSchema,
  eventBulkAttendeeInvitesSchema,
  eventBulkSpeakerInvitesPreviewSchema,
  eventBulkSpeakerInvitesSchema,
  eventInviteBulkResponseSchema,
  eventInvitePreviewResponseSchema,
} from "./event-invite-bulk";
import { eventInvitesListResponseSchema } from "./event-invites";
import { jsonErrorResponse } from "./api-common";

export const groupEventSpeakerInvitesListRouteSchema = {
  ...groupEventInvitesListRouteSchema,
  summary: "List speaker invitations for a proposal program",
  description: "Returns a bounded, speaker-only invitation page after event-scoped proposal-management authorization.",
  responses: {
    ...groupEventInvitesListRouteSchema.responses,
    "200": {
      description: "A bounded speaker invitation page.",
      content: { "application/json": { schema: eventInvitesListResponseSchema } },
    },
  },
};

export const groupEventSpeakerInviteResendRouteSchema = {
  ...groupEventInviteResendRouteSchema,
  summary: "Resend a speaker invitation",
  description: "Re-queues a speaker invitation that remains available through the selected group proposal program.",
};

export const groupEventSpeakerInviteRevokeRouteSchema = {
  ...groupEventInviteRevokeRouteSchema,
  summary: "Revoke a speaker invitation",
  description: "Revokes a pending speaker invitation through the selected group proposal program.",
};

export const groupEventInviteBulkResponseSchema = eventInviteBulkResponseSchema;
export const groupEventInvitePreviewResponseSchema = eventInvitePreviewResponseSchema;

function previewRoute(summary: string, description: string, schema: typeof eventBulkAttendeeInvitesPreviewSchema) {
  return {
    tags: ["Groups", "Event invites"],
    summary,
    description,
    request: { params: groupEventParamsSchema, body: { content: { "application/json": { schema } }, required: true } },
    responses: {
      "200": {
        description: "A rendered invitation preview and short-lived send token.",
        content: { "application/json": { schema: groupEventInvitePreviewResponseSchema } },
      },
      "401": jsonErrorResponse("An authenticated portal identity is required."),
      "403": jsonErrorResponse("The required invitation-management permission is missing."),
      "409": jsonErrorResponse("The event or management authority changed; render a new preview."),
    },
  };
}

function bulkRoute(summary: string, description: string, schema: typeof eventBulkAttendeeInvitesSchema) {
  return {
    tags: ["Groups", "Event invites"],
    summary,
    description,
    request: { params: groupEventParamsSchema, body: { content: { "application/json": { schema } }, required: true } },
    responses: {
      "200": {
        description: "Bulk invitation results.",
        content: { "application/json": { schema: groupEventInviteBulkResponseSchema } },
      },
      "401": jsonErrorResponse("An authenticated portal identity is required."),
      "403": jsonErrorResponse("The required invitation-management permission is missing."),
      "409": jsonErrorResponse("The event schedule or management authority changed; reload and retry."),
    },
  };
}

export const groupEventAttendeeInvitePreviewRouteSchema = previewRoute(
  "Preview attendee invitations",
  "Renders an attendee invitation preview and issues a short-lived bulk-send token for this managed event.",
  eventBulkAttendeeInvitesPreviewSchema,
);
export const groupEventAttendeeInviteBulkRouteSchema = bulkRoute(
  "Create attendee invitations",
  "Creates attendee invitations and their durable email intents after confirming a fresh preview.",
  eventBulkAttendeeInvitesSchema,
);
export const groupEventSpeakerInvitePreviewRouteSchema = previewRoute(
  "Preview speaker invitations",
  "Renders a speaker invitation preview and issues a short-lived bulk-send token for this proposal program.",
  eventBulkSpeakerInvitesPreviewSchema,
);
export const groupEventSpeakerInviteBulkRouteSchema = bulkRoute(
  "Create speaker invitations",
  "Creates speaker invitations and their durable email intents after confirming a fresh preview.",
  eventBulkSpeakerInvitesSchema,
);
