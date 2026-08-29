import { z } from "zod";
import { successResponseSchema, utcInstantSchema } from "./api-common";
import { eventInviteValiditySchema } from "./event-invite-validity";
import { inviteeSchema } from "./registration";
import { sourceTypeSchema } from "./source";

export type EventInviteType = "attendee" | "speaker";
export const EVENT_INVITE_SEND_BATCH_SIZE = 500;

const inviteNameSchema = (max: number) => z.string().trim().min(1).max(max).optional();
const eventInviteeSchema = inviteeSchema.extend({
  firstName: inviteNameSchema(80),
  lastName: inviteNameSchema(120),
  sourceType: sourceTypeSchema.optional(),
});

const eventBulkInvitesSchema = eventInviteValiditySchema.extend({
  previewToken: z.string().trim().min(16).max(2048),
  inviteDigest: z.string().length(64),
  invites: z.array(eventInviteeSchema).min(1).max(2000),
});

const eventBulkInvitesPreviewSchema = eventInviteValiditySchema.extend({
  invites: z.array(eventInviteeSchema).min(1).max(50000),
});

export const eventBulkAttendeeInvitesSchema = eventBulkInvitesSchema;
export const eventBulkSpeakerInvitesSchema = eventBulkInvitesSchema;
export const eventBulkAttendeeInvitesPreviewSchema = eventBulkInvitesPreviewSchema;
export const eventBulkSpeakerInvitesPreviewSchema = eventBulkInvitesPreviewSchema;

export const eventInvitePreviewSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  previewToken: z.string(),
  inviteDigest: z.string(),
  inviteExpiresAt: z.string(),
});

const eventInviteSendBatchSchema = z.object({
  offset: z.number().int().nonnegative(),
  count: z.number().int().positive().max(EVENT_INVITE_SEND_BATCH_SIZE),
  previewToken: z.string(),
  inviteDigest: z.string().length(64),
});

export const eventInvitePreviewResponseSchema = successResponseSchema.extend({
  ...eventInvitePreviewSchema.shape,
  previewExpiresAt: utcInstantSchema,
  recipientCount: z.number().int().nonnegative(),
  sendBatches: z.array(eventInviteSendBatchSchema).min(1).max(100),
});

const eventBulkInviteResultSchema = z.object({ email: z.email() });
export const eventInviteBulkResponseSchema = successResponseSchema.extend({
  created: z.array(eventBulkInviteResultSchema),
  endorsed: z.array(eventBulkInviteResultSchema),
  skipped: z.array(eventBulkInviteResultSchema),
});
