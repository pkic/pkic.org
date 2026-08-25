import { z } from "zod";
import { jsonErrorResponse, successResponseSchema } from "./api-common";
import { groupReferenceParamsSchema } from "./groups";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema } from "./pagination";
import {
  endorseProposalResponseSchema,
  proposalDetailResponseSchema,
  proposalSummarySchema,
  voteProposalFieldsSchema,
  voteProposalStatusSchema,
} from "./votes";
import { adminListProposalsQuerySchema, adminRejectProposalSchema } from "./votes-admin";

export const GROUP_VOTE_PROPOSAL_CAPABILITIES = [
  "view",
  "endorse",
  "withdraw_endorsement",
  "withdraw",
  "approve",
  "reject",
] as const;
export const groupVoteProposalCapabilitySchema = z.enum(GROUP_VOTE_PROPOSAL_CAPABILITIES);

export const groupVoteProposalSchema = proposalSummarySchema.extend({
  capabilities: z.array(groupVoteProposalCapabilitySchema).max(GROUP_VOTE_PROPOSAL_CAPABILITIES.length),
});
export type GroupVoteProposal = z.infer<typeof groupVoteProposalSchema>;

export const groupVoteProposalParamsSchema = groupReferenceParamsSchema.extend({ proposalId: databaseIdSchema });
export const groupVoteProposalCreateSchema = voteProposalFieldsSchema;
export const groupVoteProposalCreateResponseSchema = z.object({ proposal: groupVoteProposalSchema });
export const groupVoteProposalsListQuerySchema = adminListProposalsQuerySchema.omit({ ownerGroupId: true });
export type GroupVoteProposalsListQuery = z.infer<typeof groupVoteProposalsListQuerySchema>;
export const groupVoteProposalsListResponseSchema = paginatedResponseSchema("proposals", groupVoteProposalSchema);
export const groupVoteProposalDetailResponseSchema = proposalDetailResponseSchema.extend({
  proposal: groupVoteProposalSchema,
});
export const groupVoteProposalEndorseResponseSchema = endorseProposalResponseSchema.extend({
  proposal: groupVoteProposalSchema,
});
export const groupVoteProposalMutationResponseSchema = successResponseSchema;
export const groupVoteProposalApproveResponseSchema = z.object({
  proposal: groupVoteProposalSchema,
  convertedVote: endorseProposalResponseSchema.shape.convertedVote.unwrap(),
});
export const groupVoteProposalRejectSchema = adminRejectProposalSchema;
export const groupVoteProposalRejectResponseSchema = z.object({ proposal: groupVoteProposalSchema });

export const groupVoteProposalsListRouteSchema = {
  tags: ["Group Vote Proposals"],
  summary: "List vote proposals through the selected group",
  description:
    "Filtering, search, sorting, counting, pagination, and live participant or manager authorization execute in D1.",
  request: { params: groupReferenceParamsSchema, query: groupVoteProposalsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded proposal page with context-specific capabilities.",
      content: { "application/json": { schema: groupVoteProposalsListResponseSchema } },
    },
    "401": jsonErrorResponse("An authenticated portal identity is required."),
    "404": jsonErrorResponse("Group not found or not visible."),
  },
};

export const groupVoteProposalCreateRouteSchema = {
  tags: ["Group Vote Proposals"],
  summary: "Propose a vote for the selected group",
  request: {
    params: groupReferenceParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupVoteProposalCreateSchema } } },
  },
  responses: {
    "200": {
      description: "Proposal submitted for endorsement.",
      content: { "application/json": { schema: groupVoteProposalCreateResponseSchema } },
    },
    "403": jsonErrorResponse("An active eligible voting capacity in the selected group is required."),
    "400": jsonErrorResponse("Invalid or unsupported proposal request."),
    "422": jsonErrorResponse("The validated proposal cannot produce a valid vote."),
  },
};

export const groupVoteProposalDetailRouteSchema = {
  tags: ["Group Vote Proposals"],
  summary: "Get one vote proposal through the selected group",
  request: { params: groupVoteProposalParamsSchema },
  responses: {
    "200": {
      description: "Proposal detail and current endorsers.",
      content: { "application/json": { schema: groupVoteProposalDetailResponseSchema } },
    },
    "404": jsonErrorResponse("Proposal not found or not visible through this group."),
  },
};

export const groupVoteProposalWithdrawRouteSchema = {
  tags: ["Group Vote Proposals"],
  summary: "Withdraw my proposal through the selected group",
  request: { params: groupVoteProposalParamsSchema },
  responses: {
    "200": {
      description: "Proposal withdrawn.",
      content: { "application/json": { schema: groupVoteProposalMutationResponseSchema } },
    },
    "403": jsonErrorResponse("Only the proposer may withdraw this proposal."),
    "404": jsonErrorResponse("Proposal not found through this group."),
    "409": jsonErrorResponse("The proposal is no longer withdrawable."),
  },
};

export const groupVoteProposalEndorseRouteSchema = {
  tags: ["Group Vote Proposals"],
  summary: "Endorse a proposal through the selected group",
  request: { params: groupVoteProposalParamsSchema },
  responses: {
    "200": {
      description: "Endorsement recorded; the proposal may have converted to a vote.",
      content: { "application/json": { schema: groupVoteProposalEndorseResponseSchema } },
    },
    "403": jsonErrorResponse("An active eligible voting capacity in the selected group is required."),
    "404": jsonErrorResponse("Proposal not found through this group."),
    "409": jsonErrorResponse("The proposal is no longer open for endorsement."),
  },
};

export const groupVoteProposalEndorsementWithdrawRouteSchema = {
  tags: ["Group Vote Proposals"],
  summary: "Withdraw my endorsement through the selected group",
  request: { params: groupVoteProposalParamsSchema },
  responses: {
    "200": {
      description: "Endorsement withdrawn.",
      content: { "application/json": { schema: groupVoteProposalMutationResponseSchema } },
    },
    "404": jsonErrorResponse("Proposal not found through this group."),
    "409": jsonErrorResponse("The proposal is no longer open for endorsement."),
  },
};

export const groupVoteProposalApproveRouteSchema = {
  tags: ["Group Vote Proposals"],
  summary: "Approve and convert a proposal through the selected group",
  request: { params: groupVoteProposalParamsSchema },
  responses: {
    "200": {
      description: "Proposal converted to a vote.",
      content: { "application/json": { schema: groupVoteProposalApproveResponseSchema } },
    },
    "403": jsonErrorResponse("Effective vote-management permission is required for the selected group."),
    "404": jsonErrorResponse("Proposal not found through this group."),
    "409": jsonErrorResponse("Proposal state or management permission changed."),
    "422": jsonErrorResponse("The proposal cannot produce a valid vote."),
  },
};

export const groupVoteProposalRejectRouteSchema = {
  tags: ["Group Vote Proposals"],
  summary: "Reject a proposal through the selected group",
  request: {
    params: groupVoteProposalParamsSchema,
    body: { required: true, content: { "application/json": { schema: groupVoteProposalRejectSchema } } },
  },
  responses: {
    "200": {
      description: "Proposal rejected and proposer notification queued.",
      content: { "application/json": { schema: groupVoteProposalRejectResponseSchema } },
    },
    "403": jsonErrorResponse("Effective vote-management permission is required for the selected group."),
    "404": jsonErrorResponse("Proposal not found through this group."),
    "409": jsonErrorResponse("Proposal state or management permission changed."),
  },
};

export { voteProposalStatusSchema as groupVoteProposalStatusSchema };
