import { z } from "zod";
import { eventIdSchema, successResponseSchema } from "./api-common";
import { paginatedResponseSchema } from "./pagination";
import { activeFormSummarySchema } from "./forms";
import { databaseIdSchema } from "./identifiers";
import { proposalDecisionStatusSchema, proposalStatusSchema } from "./proposal-status";
import { eventSummarySchema } from "./event-read-models";
import {
  adminSpeakerBioPatchSchema,
  MAX_PROPOSAL_PARTICIPANTS,
  proposalSessionTypesSchema,
  proposalSpeakerProfileSchema,
} from "./proposal-management";

export const proposalAccessSchema = z.object({
  eventPermissions: z.array(z.string()),
  canReview: z.boolean(),
  canFinalize: z.boolean(),
});

const adminEventProposalCoreSchema = z.object({
  id: databaseIdSchema,
  event_id: eventIdSchema,
  proposer_user_id: databaseIdSchema,
  status: proposalStatusSchema,
  proposal_type: z.string(),
  title: z.string(),
  abstract: z.string(),
  review_round: z.number().int().positive(),
  submitted_at: z.string(),
  updated_at: z.string(),
});

const proposalProposerSchema = z.object({
  proposer_email: z.string(),
  proposer_first_name: z.string().nullable(),
  proposer_last_name: z.string().nullable(),
});

const proposalDecisionSchema = z.object({
  decision_status: proposalDecisionStatusSchema.nullable(),
  decision_note: z.string().nullable(),
  decision_decided_at: z.string().nullable(),
});

export const adminEventProposalSummarySchema = adminEventProposalCoreSchema
  .extend(proposalProposerSchema.shape)
  .extend(proposalDecisionSchema.shape)
  .extend({
    review_count: z.number(),
    average_review_score: z.number().nullable(),
    recommendation_accept_count: z.number(),
    recommendation_needs_work_count: z.number(),
    recommendation_reject_count: z.number(),
  });

export const adminProposalDetailSchema = adminEventProposalCoreSchema
  .extend(proposalProposerSchema.shape)
  .extend(proposalDecisionSchema.shape)
  .extend({
    review_count: z.number(),
    details: z.record(z.string(), z.unknown()).nullable(),
  });

export const adminProposalDetailResponseSchema = z.object({
  proposal: adminProposalDetailSchema,
  access: proposalAccessSchema,
  form: activeFormSummarySchema.nullable(),
  minReviewsRequired: z.number().int().nonnegative(),
  sessionTypes: proposalSessionTypesSchema,
});

export const adminProposalSpeakerSchema = proposalSpeakerProfileSchema.extend({
  confirmedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  declineReason: z.string().nullable(),
  termsAcceptedAt: z.string().nullable(),
  addedAt: z.string(),
  biography: z.string().nullable(),
  profileComplete: z.boolean(),
  hasHeadshot: z.boolean(),
  hasBio: z.boolean(),
});

export const adminProposalSpeakersResponseSchema = z.object({
  proposal: z.object({
    id: databaseIdSchema,
    title: z.string(),
    status: proposalStatusSchema,
    presentationDeadline: z.string().nullable(),
    presentationUploaded: z.boolean(),
    presentationUploadedAt: z.string().nullable(),
  }),
  summary: z.object({
    total: z.number().int().nonnegative(),
    confirmed: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    declined: z.number().int().nonnegative(),
    profileComplete: z.number().int().nonnegative(),
    presentationUploaded: z.number().int().min(0).max(1),
  }),
  speakers: z.array(adminProposalSpeakerSchema).max(MAX_PROPOSAL_PARTICIPANTS),
});

export const adminProposalSpeakerPatchResponseSchema = successResponseSchema.extend({
  speaker: adminProposalSpeakerSchema,
});
export const adminProposalSpeakerReminderResponseSchema = successResponseSchema;
export const adminProposalSpeakerRemindersResponseSchema = successResponseSchema.extend({
  queued: z.number().int().nonnegative(),
});

export type AdminProposalSpeakerPatch = z.infer<typeof adminSpeakerBioPatchSchema>;
export type AdminProposalSpeaker = z.infer<typeof adminProposalSpeakerSchema>;
export type AdminProposalSpeakersResponse = z.infer<typeof adminProposalSpeakersResponseSchema>;
export type AdminProposalSpeakerPatchResponse = z.infer<typeof adminProposalSpeakerPatchResponseSchema>;

export { proposalSessionTypeSchema } from "./proposal-management";

export const proposalDecisionPreviewMessageSchema = z.object({
  id: z.string(),
  templateKey: z.string(),
  recipientEmail: z.string(),
  recipientLabel: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  templateMissing: z.boolean(),
});

export const proposalDecisionPreviewResponseSchema = successResponseSchema.extend({
  recipientCount: z.number().int().nonnegative(),
  emailCount: z.number().int().nonnegative(),
  layoutMissing: z.boolean(),
  missingTemplateKeys: z.array(z.string()),
  messages: z.array(proposalDecisionPreviewMessageSchema),
});

export const proposalStatsSchema = z.object({
  // Recommendation keys remain open for historical/configurable review policy;
  // their values are still counts.
  byStatus: z.partialRecord(proposalStatusSchema, z.number().int().nonnegative()),
  byRecommendation: z.record(z.string(), z.number().int().nonnegative()),
  reviewedCount: z.number().int().nonnegative(),
  unreviewedCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export const proposalReminderResponseSchema = z.object({ queued: z.number() });

export const adminEventProposalsResponseSchema = paginatedResponseSchema(
  "proposals",
  adminEventProposalSummarySchema,
).extend({
  event: eventSummarySchema,
  access: proposalAccessSchema,
  stats: proposalStatsSchema,
});

export type ProposalAccess = z.infer<typeof proposalAccessSchema>;
export type AdminEventProposalSummary = z.infer<typeof adminEventProposalSummarySchema>;
export type AdminProposalDetailResponse = z.infer<typeof adminProposalDetailResponseSchema>;
export type ProposalDecisionPreviewResponse = z.infer<typeof proposalDecisionPreviewResponseSchema>;
export type ProposalStats = z.infer<typeof proposalStatsSchema>;
export type AdminEventProposalsResponse = z.infer<typeof adminEventProposalsResponseSchema>;
