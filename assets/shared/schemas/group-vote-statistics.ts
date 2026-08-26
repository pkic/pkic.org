import { z } from "zod";
import { jsonErrorResponse } from "./api-common";
import { groupVoteParamsSchema } from "./group-votes";
import { databaseIdSchema } from "./identifiers";
import { voteBallotCountsSchema, voteElectorateModeSchema, voteStatusSchema } from "./votes";

const voteParticipationUnitSchema = z.enum(["member", "person"]);

export const voteParticipationStatisticsSchema = z.object({
  unit: voteParticipationUnitSchema,
  currentEligible: z.number().int().nonnegative(),
  currentEligibleCast: z.number().int().nonnegative(),
  currentEligibleNotCast: z.number().int().nonnegative(),
  effectiveBallots: z.number().int().nonnegative(),
  ballotsWithoutCurrentEligibility: z.number().int().nonnegative(),
});

const unavailableVoteAggregateSchema = z.object({
  availability: z.enum(["withheld_until_closed", "unavailable"]),
});

const motionVoteAggregateSchema = z.object({
  availability: z.literal("available"),
  kind: z.literal("motion"),
  counts: voteBallotCountsSchema,
});

const electionCandidateCountSchema = z.object({
  candidateId: databaseIdSchema,
  candidateName: z.string(),
  count: z.number().int().nonnegative(),
});

const electionVoteAggregateSchema = z.object({
  availability: z.literal("available"),
  kind: z.literal("election"),
  candidates: z.array(electionCandidateCountSchema),
});

export const groupVoteStatisticsResponseSchema = z.object({
  voteId: databaseIdSchema,
  groupId: databaseIdSchema,
  round: z.number().int().positive(),
  status: voteStatusSchema,
  electorateMode: voteElectorateModeSchema,
  participation: voteParticipationStatisticsSchema,
  aggregate: z.union([unavailableVoteAggregateSchema, motionVoteAggregateSchema, electionVoteAggregateSchema]),
});
export type GroupVoteStatisticsResponse = z.infer<typeof groupVoteStatisticsResponseSchema>;

export const groupVoteStatisticsRouteSchema = {
  tags: ["Group Vote Management"],
  summary: "Get aggregate vote participation statistics",
  description:
    "Returns identity-free, current-eligibility participation statistics. Choice counts remain hidden until the vote closes.",
  request: { params: groupVoteParamsSchema },
  responses: {
    "200": {
      description: "Aggregate vote statistics through the selected management context.",
      content: { "application/json": { schema: groupVoteStatisticsResponseSchema } },
    },
    "403": jsonErrorResponse("The selected group does not provide vote-management access."),
    "404": jsonErrorResponse("Vote not found."),
    "409": jsonErrorResponse("Vote-management access changed during the read."),
  },
};
