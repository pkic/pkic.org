import { z } from "zod";
import { booleanQueryFlagSchema, eventIdSchema } from "./api-common";
import { eventSummarySchema } from "./event-read-models";
import { activeFormSummarySchema } from "./forms";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema, sortColumnSchemaWithDefault } from "./pagination";
import { proposalSessionTypesSchema } from "./proposal-management";
import { proposalRecommendationSchema } from "./proposal-reviews";
import { proposalAdminStatusFilterSchema, proposalDecisionStatusSchema, proposalStatusSchema } from "./proposal-status";
import { eventInviteWindowSchema } from "./event-invite-validity";

/** Canonical server-side list dialect for program proposal catalogues. */
export const EVENT_PROPOSALS_SORT_COLUMNS = [
  "submittedAt",
  "score",
  "reviews",
  "title",
  "proposer",
  "type",
  "status",
  "decision",
  "recommendations",
] as const;

export const eventProposalsListQuerySchema = listQuerySchema(EVENT_PROPOSALS_SORT_COLUMNS).extend({
  sort: sortColumnSchemaWithDefault(EVENT_PROPOSALS_SORT_COLUMNS, "-submittedAt"),
  status: proposalAdminStatusFilterSchema.optional(),
  recommendation: proposalRecommendationSchema.optional(),
  archived: booleanQueryFlagSchema.optional(),
});
export type EventProposalsListQuery = z.infer<typeof eventProposalsListQuerySchema>;

/** Capabilities are event-scoped and deliberately independent of group-resource grants. */
export const proposalAccessSchema = z.object({
  eventPermissions: z.array(z.string()),
  canRead: z.boolean(),
  canReview: z.boolean(),
  canFinalize: z.boolean(),
  canEditAcceptedAbstract: z.boolean(),
  canCancelAcceptedProposal: z.boolean(),
});

const eventProposalCoreSchema = z.object({
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

export const eventProposalSummarySchema = eventProposalCoreSchema
  .extend(proposalProposerSchema.shape)
  .extend(proposalDecisionSchema.shape)
  .extend({
    review_count: z.number(),
    average_review_score: z.number().nullable(),
    recommendation_accept_count: z.number(),
    recommendation_needs_work_count: z.number(),
    recommendation_reject_count: z.number(),
  });

export const eventProposalDetailSchema = eventProposalCoreSchema
  .extend(proposalProposerSchema.shape)
  .extend(proposalDecisionSchema.shape)
  .extend({
    review_count: z.number(),
    details: z.record(z.string(), z.unknown()).nullable(),
    canceled_at: z.string().nullable(),
    cancellation_comment: z.string().nullable(),
  });

export const eventProposalDetailResponseSchema = z.object({
  event: eventInviteWindowSchema,
  proposal: eventProposalDetailSchema,
  access: proposalAccessSchema,
  form: activeFormSummarySchema.nullable(),
  minReviewsRequired: z.number().int().nonnegative(),
  sessionTypes: proposalSessionTypesSchema,
});

export const proposalStatsSchema = z.object({
  byStatus: z.partialRecord(proposalStatusSchema, z.number().int().nonnegative()),
  byRecommendation: z.record(z.string(), z.number().int().nonnegative()),
  reviewedCount: z.number().int().nonnegative(),
  unreviewedCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const eventProposalsResponseSchema = paginatedResponseSchema("proposals", eventProposalSummarySchema).extend({
  event: eventSummarySchema,
  access: proposalAccessSchema,
  stats: proposalStatsSchema,
});

export type ProposalAccess = z.infer<typeof proposalAccessSchema>;
export type EventProposalSummary = z.infer<typeof eventProposalSummarySchema>;
export type EventProposalDetailResponse = z.infer<typeof eventProposalDetailResponseSchema>;
export type ProposalStats = z.infer<typeof proposalStatsSchema>;
export type EventProposalsResponse = z.infer<typeof eventProposalsResponseSchema>;
