import { eventSlugParamsSchema, jsonErrorResponse } from "./api-common";
import {
  eventEmailCampaignCreateInputSchema,
  eventEmailCampaignPreviewInputSchema,
  eventEmailCampaignPreviewResponseSchema,
  eventEmailCampaignResponseSchema,
} from "./event-email-campaigns";
import { groupEventParamsSchema } from "./group-events";

const previewResponses = {
  "200": {
    description: "Resolved recipients and a rendered campaign preview.",
    content: { "application/json": { schema: eventEmailCampaignPreviewResponseSchema } },
  },
  "400": jsonErrorResponse("Invalid campaign or message content."),
  "401": jsonErrorResponse("An authenticated user session is required."),
  "403": jsonErrorResponse("Event communication permission is required."),
  "404": jsonErrorResponse("Event not found or unavailable through this context."),
  "409": jsonErrorResponse("Event communication access changed while the preview was prepared."),
  "422": jsonErrorResponse("The recipient limit, broadcast policy, or renderer rejected the campaign."),
};

const createResponses = {
  "202": {
    description: "Campaign accepted into the durable email outbox.",
    content: { "application/json": { schema: eventEmailCampaignResponseSchema } },
  },
  "400": jsonErrorResponse("Invalid campaign content, token, or recipient set."),
  "401": jsonErrorResponse("An authenticated user session is required."),
  "403": jsonErrorResponse("Event communication permission is required."),
  "404": jsonErrorResponse("Event not found or unavailable through this context."),
  "409": jsonErrorResponse("The preview or live event communication access changed before the campaign was queued."),
  "422": jsonErrorResponse("The recipient limit, broadcast policy, or renderer rejected the campaign."),
};

export const eventEmailCampaignPreviewRouteSchema = {
  tags: ["Events", "Email campaigns"],
  summary: "Preview an event email campaign",
  description:
    "Resolves the event audience and renders a short-lived, actor-bound preview before a campaign may be queued.",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: eventEmailCampaignPreviewInputSchema } }, required: true },
  },
  responses: previewResponses,
  "x-pkic-auth": { required: true, scopes: ["events:write"] },
};

export const eventEmailCampaignCreateRouteSchema = {
  tags: ["Events", "Email campaigns"],
  summary: "Create an event email campaign",
  description:
    "Validates a fresh actor-bound preview and atomically queues the campaign through the durable email outbox.",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: eventEmailCampaignCreateInputSchema } }, required: true },
  },
  responses: createResponses,
  "x-pkic-auth": { required: true, scopes: ["events:write"] },
};

export const groupEventEmailCampaignPreviewRouteSchema = {
  tags: ["Groups", "Events", "Email campaigns"],
  summary: "Preview a managed group event email campaign",
  description:
    "Uses the selected group's live event-management capability to resolve and render an event campaign preview.",
  request: {
    params: groupEventParamsSchema,
    body: { content: { "application/json": { schema: eventEmailCampaignPreviewInputSchema } }, required: true },
  },
  responses: previewResponses,
};

export const groupEventEmailCampaignCreateRouteSchema = {
  tags: ["Groups", "Events", "Email campaigns"],
  summary: "Create a managed group event email campaign",
  description: "Rechecks selected-group event management in the same D1 transaction that queues the durable campaign.",
  request: {
    params: groupEventParamsSchema,
    body: { content: { "application/json": { schema: eventEmailCampaignCreateInputSchema } }, required: true },
  },
  responses: createResponses,
};
