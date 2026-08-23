import { z } from "zod";
import {
  adminBulkAttendeeInvitesPreviewSchema,
  adminBulkSpeakerInvitesPreviewSchema,
  adminEventCampaignPreviewSchema,
  adminEventCampaignSendSchema,
} from "./admin-events";
import { eventSlugParamsSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { inviteTypeSchema } from "./registration";

const previewTokenSchema = adminEventCampaignSendSchema.shape.previewToken;
const invitePreviewResponseSchema = successResponseSchema.extend({
  previewToken: previewTokenSchema,
  previewExpiresAt: z.string(),
  inviteDigest: z.string().regex(/^[0-9a-f]{64}$/i),
  recipientCount: z.number().int().nonnegative(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
});

export const adminAttendeeInvitePreviewResponseSchema = invitePreviewResponseSchema;
export const adminSpeakerInvitePreviewResponseSchema = invitePreviewResponseSchema;

export const adminAttendeeInvitePreviewRouteSchema = {
  tags: ["Admin events", "Invites"],
  summary: "Preview attendee invites",
  description: "Render an attendee invitation preview and issue a short-lived bulk-send token.",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: adminBulkAttendeeInvitesPreviewSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Attendee invite preview.",
      content: { "application/json": { schema: adminAttendeeInvitePreviewResponseSchema } },
    },
    "400": { description: "Invalid invite preview payload." },
  },
};

export const adminSpeakerInvitePreviewRouteSchema = {
  ...adminAttendeeInvitePreviewRouteSchema,
  summary: "Preview speaker invites",
  description: "Render a speaker invitation preview and issue a short-lived bulk-send token.",
  request: {
    params: eventSlugParamsSchema,
    body: { content: { "application/json": { schema: adminBulkSpeakerInvitesPreviewSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Speaker invite preview.",
      content: { "application/json": { schema: adminSpeakerInvitePreviewResponseSchema } },
    },
    "400": { description: "Invalid invite preview payload." },
  },
};

export const adminInviteResendResponseSchema = successResponseSchema.extend({
  inviteId: databaseIdSchema,
  resentAt: z.string(),
  inviteType: inviteTypeSchema,
});

export const adminInviteResendRouteSchema = {
  tags: ["Admin events", "Invites"],
  summary: "Resend an event invitation",
  description: "Re-queues an existing, not-yet-accepted invitation for delivery.",
  request: {
    params: eventSlugParamsSchema.extend({ inviteId: databaseIdSchema }),
  },
  responses: {
    "200": {
      description: "Invitation resent.",
      content: { "application/json": { schema: adminInviteResendResponseSchema } },
    },
    "404": { description: "Invitation not found for this event." },
    "409": { description: "Invitation cannot be resent in its current state." },
  },
};

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
    "422": { description: "Recipient limit or broadcast safety policy rejected the campaign." },
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
    "422": { description: "Recipient limit or broadcast safety policy rejected the campaign." },
  },
};
