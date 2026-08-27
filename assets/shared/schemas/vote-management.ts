import { z } from "zod";
import { groupIdSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { membershipCategorySelectionSchema } from "./membership-categories";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import {
  publicDetailLevelSchema,
  thresholdTypeSchema,
  voteElectorateModeSchema,
  voteSummaryFieldsSchema,
  voteTypeSchema,
  voteVisibilitySchema,
} from "./votes";

/** Domain-level write contracts shared by global and selected-group vote APIs. */
export const voteCandidateInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  bio: z.string().trim().max(5000).optional(),
  userId: databaseIdSchema.nullable().optional(),
});

export const voteCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10000).optional(),
  voteType: voteTypeSchema,
  ownerGroupId: groupIdSchema,
  electorateMode: voteElectorateModeSchema,
  thresholdType: thresholdTypeSchema,
  eligibleCategories: membershipCategorySelectionSchema.nullable().optional(),
  opensAt: z.iso.datetime({ offset: true }).optional(),
  closesAt: z.iso.datetime({ offset: true }),
  candidates: z.array(voteCandidateInputSchema).max(50).optional(),
});

/** A selected-group route obtains ownership from its path, never its body. */
export const selectedGroupVoteCreateInputSchema = voteCreateInputSchema.omit({ ownerGroupId: true });

export const voteUpdateInputSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  opensAt: z.iso.datetime({ offset: true }).optional(),
  closesAt: z.iso.datetime({ offset: true }).optional(),
});

export const voteVisibilityUpdateInputSchema = z.object({
  visibility: voteVisibilitySchema.optional(),
  publicDetailLevel: publicDetailLevelSchema.optional(),
});

export const VOTE_LIFECYCLE_TRANSITIONS = ["open", "close", "cancel"] as const;
export const voteLifecycleTransitionNameSchema = z.enum(VOTE_LIFECYCLE_TRANSITIONS);
export const voteLifecycleTransitionSchema = z.discriminatedUnion("transition", [
  z.object({ transition: z.literal("open") }),
  z.object({ transition: z.literal("close") }),
  z.object({ transition: z.literal("cancel"), reason: z.string().trim().min(1).max(1000) }),
]);
export type VoteLifecycleTransition = z.infer<typeof voteLifecycleTransitionSchema>;
export const voteLifecycleOutcomeSchema = z.enum(["opened", "closed", "round_advanced", "cancelled"]);

export const voteMutationResponseSchema = z.object({ vote: z.object(voteSummaryFieldsSchema) });
export const voteLifecycleTransitionResponseSchema = voteMutationResponseSchema.extend({
  outcome: voteLifecycleOutcomeSchema,
});

export const rawVoteBallotSchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  memberId: databaseIdSchema.nullable(),
  choice: z.string(),
  round: z.number(),
  submittedAt: z.string(),
  updatedAt: z.string(),
});
export type RawVoteBallot = z.infer<typeof rawVoteBallotSchema>;

export const RAW_VOTE_BALLOT_SORT_COLUMNS = ["submittedAt", "round", "choice", "userId", "memberId"] as const;
export const rawVoteBallotsListQuerySchema = listQuerySchema(RAW_VOTE_BALLOT_SORT_COLUMNS).extend({
  round: z.coerce.number().int().min(1).optional(),
});
export type RawVoteBallotsListQuery = z.infer<typeof rawVoteBallotsListQuerySchema>;
export const rawVoteBallotsListResponseSchema = paginatedResponseSchema("ballots", rawVoteBallotSchema);
