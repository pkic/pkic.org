import {
  eventIdSchema,
  emailMessageTypeSchema,
  frontendPathPattern,
  slugPattern,
  successResponseSchema,
  termKeyPattern,
  trimmedString,
  versionPattern,
} from "./api-common";
import { z } from "zod";
import { paginatedResponseSchema, searchableListQuerySchema, sortColumnSchema } from "./pagination";
import { attendanceTypeSchema } from "./registration";
import { EVENT_PROPOSALS_SORT_COLUMNS, eventProposalsListQuerySchema } from "./event-proposals";
import { attendeeInviteLimitSchema, eventManagementDetailResponseSchema } from "./event-management";
import { eventVisibilitySchema } from "./event-series";
import { eventRegistrationStatusFilterSchema } from "./event-registrations";

/** Legacy admin-only extension for auditing soft-deleted proposal records. */
export const adminEventProposalsQuerySchema = eventProposalsListQuerySchema.extend({
  deleted: z.literal("1").optional(),
});
export type AdminEventProposalsQuery = z.infer<typeof adminEventProposalsQuerySchema>;
export { EVENT_PROPOSALS_SORT_COLUMNS };

export const EVENTS_LIST_SORT_COLUMNS = ["name", "starts_at", "registration_mode", "total_registrations"] as const;
export const eventsListSortValueSchema = sortColumnSchema(EVENTS_LIST_SORT_COLUMNS);
export const adminEventsListQuerySchema = searchableListQuerySchema(eventsListSortValueSchema);
export type AdminEventsListQuery = z.infer<typeof adminEventsListQuerySchema>;

export const adminEventSummarySchema = z.object({
  id: eventIdSchema,
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
  starts_at: z.string().nullable(),
  ends_at: z.string().nullable(),
  registration_mode: z.string(),
  invite_limit_attendee: z.number(),
  confirmed_registrations: z.number(),
  total_registrations: z.number(),
  pending_invites: z.number(),
});
export const adminEventCreateResponseSchema = eventManagementDetailResponseSchema;
export type AdminEventSummary = z.infer<typeof adminEventSummarySchema>;
export const adminEventsListResponseSchema = paginatedResponseSchema("events", adminEventSummarySchema);

const termSchema = z.object({
  termKey: z.string().trim().regex(termKeyPattern),
  version: z.string().trim().regex(versionPattern),
  required: z.boolean().optional(),
  contentRef: trimmedString(1, 500).optional(),
  displayText: trimmedString(3, 4000).optional(),
});

const frontendRoutesSchema = z.object({
  registration: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  registrationConfirm: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  proposal: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  registrationManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  proposalManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
  speakerManage: z.string().trim().regex(frontendPathPattern).max(300).optional(),
});

export const adminEventSyncSchema = z.object({
  event: z.object({
    slug: z.string().trim().regex(slugPattern),
    name: trimmedString(3, 180),
    timezone: trimmedString(2, 64),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    registrationMode: z.enum(["invite_only", "invite_or_open", "open"]).optional(),
    visibility: eventVisibilitySchema.optional(),
    inviteLimitAttendee: attendeeInviteLimitSchema.optional(),
    frontend: z.object({ routes: frontendRoutesSchema }).optional(),
    settings: z.record(z.string().trim().min(1).max(80), z.unknown()).optional(),
  }),
  terms: z
    .object({
      attendee: z.array(termSchema).max(40).default([]),
      speaker: z.array(termSchema).max(40).default([]),
    })
    .optional(),
});
export type AdminEventSyncInput = z.infer<typeof adminEventSyncSchema>;

export const adminEventEmailPreviewResponseSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  recipientCount: z.number().optional(),
  previewToken: z.string().optional(),
});
export const adminEventEmailSendResponseSchema = z.object({
  queuedRecipients: z.number().optional(),
  queuedBatches: z.number().optional(),
});

export const adminWaitlistPromotionResponseSchema = successResponseSchema.extend({
  dayRegistrationOffers: z.number().int().nonnegative(),
  affectedRegistrations: z.array(z.string()),
});
const campaignFilterSchema = z.object({
  audience: z.enum(["attendees", "speakers"]),
  attendeeStatus: eventRegistrationStatusFilterSchema.optional(),
  attendanceType: z.union([z.literal("all"), attendanceTypeSchema]).optional(),
  dayDate: z.string().trim().max(20).optional(),
  dayWaitlistStatus: z.enum(["all", "active", "waiting", "offered", "accepted", "none"]).optional(),
  speakerStatus: z.enum(["all", "confirmed", "invited", "pending"]).optional(),
});

const campaignBaseSchema = z.object({
  templateKey: z.string().trim().min(1).max(200).optional(),
  subjectOverride: z.string().trim().min(1).max(500).optional(),
  customText: z.string().trim().max(100_000).optional(),
  bodyContent: z.string().trim().max(100_000).optional(),
  messageType: emailMessageTypeSchema.optional(),
  sendMode: z.enum(["personal", "bcc_batch"]),
  batchSize: z.number().int().min(1).max(500).default(50),
  filter: campaignFilterSchema,
});

export const adminEventCampaignPreviewSchema = campaignBaseSchema;
export const adminEventCampaignSendSchema = campaignBaseSchema.extend({
  previewToken: z.string().trim().min(16).max(2048),
});
