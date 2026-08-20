import { z } from "zod";
import { eventIdSchema } from "./api-common";
import { pageInfoSchema } from "./pagination";
import { activeFormSummarySchema } from "./forms";
import { databaseIdSchema } from "./identifiers";

export const proposalAccessSchema = z.object({
  eventPermissions: z.array(z.string()),
  canReview: z.boolean(),
  canFinalize: z.boolean(),
});

const adminEventProposalCoreSchema = z.object({
  id: databaseIdSchema,
  event_id: eventIdSchema,
  proposer_user_id: databaseIdSchema,
  status: z.string(),
  proposal_type: z.string(),
  title: z.string(),
  abstract: z.string(),
  submitted_at: z.string(),
  updated_at: z.string(),
});

const proposalProposerSchema = z.object({
  proposer_email: z.string(),
  proposer_first_name: z.string().nullable(),
  proposer_last_name: z.string().nullable(),
});

const proposalDecisionSchema = z.object({
  decision_status: z.string().nullable(),
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

export const proposalSessionTypeSchema = z.object({
  label: z.string(),
  requiresPresentation: z.boolean(),
});

export const adminProposalDetailResponseSchema = z.object({
  proposal: adminProposalDetailSchema,
  access: proposalAccessSchema,
  form: activeFormSummarySchema.nullable(),
  minReviewsRequired: z.number().int().nonnegative(),
  sessionTypes: z.array(proposalSessionTypeSchema),
});

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

export const proposalDecisionPreviewResponseSchema = z.object({
  success: z.literal(true),
  recipientCount: z.number().int().nonnegative(),
  emailCount: z.number().int().nonnegative(),
  layoutMissing: z.boolean(),
  missingTemplateKeys: z.array(z.string()),
  messages: z.array(proposalDecisionPreviewMessageSchema),
});

export const proposalStatsSchema = z.object({
  byStatus: z.record(z.string(), z.number()),
  byRecommendation: z.record(z.string(), z.number()),
  reviewedCount: z.number(),
  unreviewedCount: z.number(),
  total: z.number(),
});

export const adminEventProposalsResponseSchema = z.object({
  event: z.object({ id: eventIdSchema, slug: z.string(), name: z.string() }),
  access: proposalAccessSchema,
  proposals: z.array(adminEventProposalSummarySchema),
  stats: proposalStatsSchema,
  page: pageInfoSchema,
});

export type ProposalAccess = z.infer<typeof proposalAccessSchema>;
export type AdminEventProposalSummary = z.infer<typeof adminEventProposalSummarySchema>;
export type AdminProposalDetailResponse = z.infer<typeof adminProposalDetailResponseSchema>;
export type ProposalDecisionPreviewResponse = z.infer<typeof proposalDecisionPreviewResponseSchema>;
export type ProposalStats = z.infer<typeof proposalStatsSchema>;
export type AdminEventProposalsResponse = z.infer<typeof adminEventProposalsResponseSchema>;
