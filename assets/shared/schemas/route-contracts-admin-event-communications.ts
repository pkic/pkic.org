import { z } from "zod";
import { adminEventCampaignPreviewSchema, adminEventCampaignSendSchema } from "./admin-events";
import { eventSlugParamsSchema, successResponseSchema } from "./api-common";

const previewTokenSchema = adminEventCampaignSendSchema.shape.previewToken;

export const adminEventCampaignPreviewResponseSchema = successResponseSchema.extend({
  recipientCount: z.number().int().nonnegative(),
  batchCount: z.number().int().nonnegative(),
  previewToken: previewTokenSchema,
  previewExpiresAt: z.string(),
  sampleRecipients: z.array(z.string()),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

export const adminEventCampaignPreviewRouteSchema = {
  tags: ["Admin events", "Email campaigns"],
  summary: "Preview an event email campaign",
  description: "Resolve recipients and render a campaign preview before sending.",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: adminEventCampaignPreviewSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Campaign preview.",
      content: { "application/json": { schema: adminEventCampaignPreviewResponseSchema } },
    },
    "400": { description: "Invalid campaign or message content." },
    "422": { description: "Recipient limit, broadcast safety policy, or email-renderer limit rejected the campaign." },
  },
};

export const adminEventCampaignSendResponseSchema = successResponseSchema.extend({
  queuedRecipients: z.number().int().nonnegative(),
  queuedBatches: z.number().int().nonnegative(),
  mode: adminEventCampaignSendSchema.shape.sendMode,
});

export const adminEventCampaignSendRouteSchema = {
  tags: ["Admin events", "Email campaigns"],
  summary: "Send an event email campaign",
  description: "Validate a fresh campaign preview token and queue the approved campaign for delivery.",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: adminEventCampaignSendSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Campaign queued.",
      content: { "application/json": { schema: adminEventCampaignSendResponseSchema } },
    },
    "400": { description: "Invalid campaign content, token, or recipient set." },
    "409": { description: "Campaign preview token expired or is stale." },
    "422": { description: "Recipient limit, broadcast safety policy, or email-renderer limit rejected the campaign." },
  },
};
