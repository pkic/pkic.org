import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, pageInfoSchema } from "./pagination";
import { trimmedString } from "./api-common";

export const PROPOSAL_RECOMMENDATIONS = ["accept", "reject", "needs-work"] as const;
export const proposalRecommendationSchema = z.enum(PROPOSAL_RECOMMENDATIONS);

export const proposalReviewUpsertSchema = z.object({
  recommendation: proposalRecommendationSchema,
  score: z.number().int().min(1).max(10),
  reviewerComment: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    trimmedString(3, 10_000).optional(),
  ),
  applicantNote: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    trimmedString(3, 10_000).optional(),
  ),
});

export const proposalReviewPatchSchema = z
  .object({
    recommendation: proposalRecommendationSchema.optional(),
    score: z.number().int().min(1).max(10).nullable().optional(),
    reviewerComment: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      trimmedString(3, 10_000).nullable().optional(),
    ),
    applicantNote: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      trimmedString(3, 10_000).nullable().optional(),
    ),
  })
  .refine(
    (value) =>
      value.recommendation !== undefined ||
      value.score !== undefined ||
      value.reviewerComment !== undefined ||
      value.applicantNote !== undefined,
    { message: "Provide at least one review field to update" },
  );

export const proposalReviewSchema = z.object({
  id: databaseIdSchema,
  proposal_id: databaseIdSchema,
  reviewer_user_id: databaseIdSchema,
  review_round: z.number().int().positive(),
  recommendation: proposalRecommendationSchema,
  score: z.number().nullable(),
  reviewer_comment: z.string().nullable(),
  applicant_note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  reviewer_email: z.email().nullable(),
  reviewer_first_name: z.string().nullable(),
  reviewer_last_name: z.string().nullable(),
});

export const PROPOSAL_REVIEW_SORT_COLUMNS = ["updatedAt", "reviewer", "recommendation", "score"] as const;
export const proposalReviewsListQuerySchema = listQuerySchema(PROPOSAL_REVIEW_SORT_COLUMNS).extend({
  recommendation: proposalRecommendationSchema.optional(),
});

export const proposalReviewSummarySchema = z.object({
  totalReviews: z.number().int().nonnegative(),
  averageScore: z.number().nullable(),
  acceptCount: z.number().int().nonnegative(),
  needsWorkCount: z.number().int().nonnegative(),
  rejectCount: z.number().int().nonnegative(),
  minReviewsRequired: z.number().int().nonnegative(),
  quorumMet: z.boolean(),
});

export const proposalReviewsListResponseSchema = z.object({
  proposalId: databaseIdSchema,
  reviews: z.array(proposalReviewSchema),
  myReview: proposalReviewSchema.nullable(),
  summary: proposalReviewSummarySchema,
  page: pageInfoSchema,
});

export const proposalReviewWriteResponseSchema = z.object({
  success: z.literal(true),
  review: proposalReviewSchema,
});

export type ProposalRecommendation = z.infer<typeof proposalRecommendationSchema>;
export type ProposalReviewUpsert = z.infer<typeof proposalReviewUpsertSchema>;
export type ProposalReviewPatch = z.infer<typeof proposalReviewPatchSchema>;
export type ProposalReview = z.infer<typeof proposalReviewSchema>;
export type ProposalReviewsListQuery = z.infer<typeof proposalReviewsListQuerySchema>;
export type ProposalReviewSummary = z.infer<typeof proposalReviewSummarySchema>;
