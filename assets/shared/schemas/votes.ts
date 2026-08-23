/**
 * Voting system. Backs the public `/api/v1/votes*`
 * endpoints, the authenticated-member `/api/v1/portal/votes*` and
 * `/api/v1/portal/vote-proposals*` endpoints, and the staff/WG-chair
 * `/api/v1/admin/votes*` and `/api/v1/admin/vote-proposals*` endpoints.
 */
import { z } from "zod";
import { successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { VOTING_CATEGORY_LETTERS } from "./membership-categories";
import { workingGroupIdSchema } from "./working-groups";

export const VOTE_TYPES = ["election", "motion", "consultation"] as const;
export const voteTypeSchema = z.enum(VOTE_TYPES);

export const VOTE_SCOPE_TYPES = ["forum", "working_group"] as const;
export const voteScopeTypeSchema = z.enum(VOTE_SCOPE_TYPES);

export const THRESHOLD_TYPES = ["simple_majority", "supermajority", "successive_elimination"] as const;
export const thresholdTypeSchema = z.enum(THRESHOLD_TYPES);

export const VOTE_VISIBILITIES = ["private", "public"] as const;
export const voteVisibilitySchema = z.enum(VOTE_VISIBILITIES);

export const PUBLIC_DETAIL_LEVELS = ["outcome_only", "aggregate", "full_breakdown"] as const;
export const publicDetailLevelSchema = z.enum(PUBLIC_DETAIL_LEVELS);

export const VOTE_STATUSES = ["scheduled", "open", "closed", "cancelled"] as const;
export const voteStatusSchema = z.enum(VOTE_STATUSES);

export const VOTE_PROPOSAL_STATUSES = [
  "open_for_endorsement",
  "endorsed",
  "rejected",
  "withdrawn",
  "converted_to_vote",
] as const;
export const voteProposalStatusSchema = z.enum(VOTE_PROPOSAL_STATUSES);

export const BALLOT_CHOICES = ["in_favor", "opposed", "abstain"] as const;

// ── Closed-vote result contract ──────────────────────────────────────
// result_json is written by exactly two producers, never a third shape:
// functions/_lib/services/votes/tally.ts's computeMotionResult (motions
// and consultations) and votes/closing.ts's { rounds, winnerCandidateId }
// (elections). There's no literal discriminant tag on either — the
// caller already knows which shape to expect from the vote's own
// voteType — so this is a plain (not zod discriminatedUnion) union of
// the two real shapes, not `z.unknown()`.

export const voteBallotCountsSchema = z.object({
  in_favor: z.number().int().nonnegative(),
  opposed: z.number().int().nonnegative(),
  abstain: z.number().int().nonnegative(),
});

export const motionVoteResultSchema = z.object({
  thresholdType: thresholdTypeSchema.extract(["simple_majority", "supermajority"]),
  counts: voteBallotCountsSchema,
  totalBallots: z.number().int().nonnegative(),
  outcome: z.enum(["passed", "failed"]),
});

export const electionRoundTallySchema = z.object({
  round: z.number().int().nonnegative(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  eliminatedCandidateIds: z.array(z.string()),
  winnerCandidateId: z.string().nullable(),
});

export const electionVoteResultSchema = z.object({
  rounds: z.array(electionRoundTallySchema),
  winnerCandidateId: z.string().nullable().optional(),
});

/** Full-detail closed-vote result, as returned by the staff-only ballots/results endpoints. */
export const voteFullResultSchema = z.union([motionVoteResultSchema, electionVoteResultSchema]);

/**
 * Redacted shape returned when a public vote's publicDetailLevel is
 * 'outcome_only' — see votes/public.ts's publicResultForDetailLevel.
 */
export const voteOutcomeOnlyResultSchema = z.object({ outcome: z.string().nullable() });

/**
 * result as returned by the public/portal list and detail endpoints: null
 * before close, or — for public endpoints — outcome-only or the full
 * shape depending on the vote's publicDetailLevel (portal endpoints
 * always return the full shape, never outcome-only).
 */
// Parse full results first. Zod object schemas strip unknown keys by default,
// so putting the smaller outcome-only projection first would silently discard
// counts/rounds from otherwise valid closed-vote responses.
export const voteResultSchema = z.union([voteFullResultSchema, voteOutcomeOnlyResultSchema]).nullable();

export const voteIdParamsSchema = z.object({ id: databaseIdSchema });
export const voteSlugParamsSchema = z.object({ slug: z.string() });
export const proposalIdParamsSchema = z.object({ id: databaseIdSchema });

export const candidateSummarySchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema.nullable(),
  candidateName: z.string(),
  candidateBio: z.string().nullable(),
  sortOrder: z.number(),
  eliminatedRound: z.number().nullable(),
});

export const voteSummaryFieldsSchema = {
  id: databaseIdSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  voteType: voteTypeSchema,
  scopeType: voteScopeTypeSchema,
  scopeId: workingGroupIdSchema.nullable(),
  thresholdType: thresholdTypeSchema,
  eligibleCategories: z.array(z.string()).nullable(),
  opensAt: z.string(),
  closesAt: z.string(),
  currentRound: z.number(),
  status: voteStatusSchema,
  visibility: voteVisibilitySchema,
  publicDetailLevel: publicDetailLevelSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
};

export const publicVoteSchema = z.object({
  ...voteSummaryFieldsSchema,
  candidates: z.array(candidateSummarySchema).nullable(),
  result: voteResultSchema,
});

export const portalVoteSchema = z.object({
  ...voteSummaryFieldsSchema,
  scopeName: z.string().nullable(),
  candidates: z.array(candidateSummarySchema).nullable(),
  canCastBallot: z.boolean(),
  hasCastBallot: z.boolean(),
  result: voteResultSchema,
});

export const portalVotesListResponseSchema = paginatedResponseSchema("votes", portalVoteSchema);
export type PortalVotesListResponse = z.infer<typeof portalVotesListResponseSchema>;

export const publicVotesListResponseSchema = paginatedResponseSchema("votes", publicVoteSchema);
export type PublicVotesListResponse = z.infer<typeof publicVotesListResponseSchema>;

export const publicVoteGetResponseSchema = z.object({ vote: publicVoteSchema });
export type PublicVoteGetResponse = z.infer<typeof publicVoteGetResponseSchema>;

// ── Public (no auth) — "Votes (public — no auth required)" ────────────

/**
 * Comma-separated list of public-facing vote statuses (`?status=open,scheduled`).
 * A bare single value (`?status=open`) still validates to a one-element
 * array, so this is a strict superset of the old single-value filter.
 */
function voteStatusListSchema<T extends [(typeof VOTE_STATUSES)[number], ...Array<(typeof VOTE_STATUSES)[number]>]>(
  allowed: T,
) {
  return z
    .string()
    .transform((value) => value.split(",").map((entry) => entry.trim()))
    .pipe(z.array(z.enum(allowed)).min(1).max(allowed.length));
}

const publicVoteStatusListSchema = voteStatusListSchema(["scheduled", "open", "closed"]);
const portalVoteStatusListSchema = voteStatusListSchema([...VOTE_STATUSES]);

export const VOTES_LIST_SORT_COLUMNS = ["title", "status", "closes_at", "created_at"] as const;

export const publicVotesListQuerySchema = listQuerySchema(VOTES_LIST_SORT_COLUMNS, { limit: 20 }).extend({
  type: voteTypeSchema.optional(),
  scope: voteScopeTypeSchema.optional(),
  wg: z.string().optional(),
  status: publicVoteStatusListSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type PublicVotesListQuery = z.infer<typeof publicVotesListQuerySchema>;

export const publicVotesListRouteSchema = {
  tags: ["Votes"],
  summary: "List public votes",
  description: "Machine-consumable, filterable, paginated. Only visibility='public' votes are returned.",
  request: { query: publicVotesListQuerySchema },
  responses: {
    "200": {
      description: "Public votes.",
      content: { "application/json": { schema: publicVotesListResponseSchema } },
    },
  },
};

export const publicVoteGetRouteSchema = {
  tags: ["Votes"],
  summary: "Public vote result at its configured detail level",
  request: { params: voteSlugParamsSchema },
  responses: {
    "200": {
      description: "Vote detail.",
      content: { "application/json": { schema: publicVoteGetResponseSchema } },
    },
    "404": { description: "Vote not found or not public." },
  },
};

export const publicVotesFeedRouteSchema = {
  tags: ["Votes"],
  summary: "RSS feed of public votes",
  responses: {
    "200": { description: "RSS/Atom XML document." },
  },
};

// ── Portal (authenticated members) ───────────────────────────────────

export const portalVotesListRouteSchema = {
  tags: ["Portal Votes"],
  summary: "List all votes visible to the caller",
  description: "Every forum vote, every public vote, plus every vote scoped to a working group the caller belongs to.",
  request: {
    query: listQuerySchema(VOTES_LIST_SORT_COLUMNS).extend({
      status: portalVoteStatusListSchema.optional(),
    }),
  },
  responses: {
    "200": {
      description: "Visible votes.",
      content: { "application/json": { schema: portalVotesListResponseSchema } },
    },
  },
};

export const portalVoteGetRouteSchema = {
  tags: ["Portal Votes"],
  summary: "Vote detail for the caller",
  request: { params: voteIdParamsSchema },
  responses: {
    "200": {
      description: "Vote detail.",
      content: { "application/json": { schema: z.object({ vote: portalVoteSchema }) } },
    },
    "404": { description: "Vote not found or not visible to the caller." },
  },
};

export const submitBallotSchema = z.object({
  choice: z.string().trim().min(1).max(100),
});
export const submitBallotResponseSchema = successResponseSchema;

export const submitBallotRouteSchema = {
  tags: ["Portal Votes"],
  summary: "Cast a ballot A–G only)",
  description:
    "Forum-level: only the organization's resolved voting delegate may call this, one ballot per organization per round. Working-group-level: one ballot per person per round, caller must be an active member of the vote's working group. H-category members may never cast a ballot.",
  request: {
    params: voteIdParamsSchema,
    body: { content: { "application/json": { schema: submitBallotSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Ballot recorded.",
      content: { "application/json": { schema: submitBallotResponseSchema } },
    },
    "403": { description: "Not eligible to vote in this vote." },
    "409": { description: "Vote is not open, or a ballot was already cast for this round." },
    "422": { description: "Invalid choice." },
  },
};

export const voteResultsRouteSchema = {
  tags: ["Portal Votes"],
  summary: "Results after close, full detail",
  request: { params: voteIdParamsSchema },
  responses: {
    "200": {
      description: "Full result detail.",
      content: { "application/json": { schema: z.object({ result: voteFullResultSchema.nullable() }) } },
    },
    "409": { description: "Results are hidden until the vote closes." },
  },
};

// ── Vote proposals (authenticated A–G members) ───────────────────────

export const proposalSummarySchema = z.object({
  id: databaseIdSchema,
  title: z.string(),
  description: z.string(),
  voteType: voteTypeSchema,
  scopeType: voteScopeTypeSchema,
  scopeId: workingGroupIdSchema.nullable(),
  scopeName: z.string().nullable(),
  proposedByUserId: databaseIdSchema,
  status: voteProposalStatusSchema,
  voteId: databaseIdSchema.nullable(),
  rejectionReason: z.string().nullable(),
  endorsementCount: z.number(),
  minEndorsersRequired: z.number(),
  createdAt: z.string(),
});
export type ProposalSummary = z.infer<typeof proposalSummarySchema>;

export const submitProposalSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(10000),
  voteType: voteTypeSchema,
  scopeType: voteScopeTypeSchema,
  scopeId: workingGroupIdSchema.nullable().optional(),
  eligibleCategories: z.array(z.enum(VOTING_CATEGORY_LETTERS)).nullable().optional(),
  proposedOpensAt: z.iso.datetime({ offset: true }).nullable().optional(),
  proposedClosesAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export const submitProposalResponseSchema = z.object({ proposal: proposalSummarySchema });

export const submitProposalRouteSchema = {
  tags: ["Vote Proposals"],
  summary: "Submit a vote proposal (A–G members only)",
  description:
    "Available only when the target scope's min_endorsers_for_ballot (forum: the membership_settings default; WG: working_groups.min_endorsers_for_ballot) is greater than 0.",
  request: {
    body: { content: { "application/json": { schema: submitProposalSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Proposal submitted, open for endorsement.",
      content: { "application/json": { schema: submitProposalResponseSchema } },
    },
    "403": {
      description:
        "Not an A–G member, not a member of the target working group, or the endorsement path is disabled for this scope.",
    },
  },
};

export const VOTE_PROPOSALS_LIST_SORT_COLUMNS = ["title", "status", "endorsement_count", "created_at"] as const;

export const listProposalsQuerySchema = listQuerySchema(VOTE_PROPOSALS_LIST_SORT_COLUMNS).extend({
  scopeType: voteScopeTypeSchema.optional(),
  scopeId: workingGroupIdSchema.optional(),
});
export type ListProposalsQuery = z.infer<typeof listProposalsQuerySchema>;

export const listProposalsResponseSchema = paginatedResponseSchema("proposals", proposalSummarySchema);

export const proposalDetailResponseSchema = z.object({
  proposal: proposalSummarySchema,
  endorserUserIds: z.array(databaseIdSchema),
});

export const endorseProposalResponseSchema = z.object({
  proposal: proposalSummarySchema,
  convertedVote: z.object(voteSummaryFieldsSchema).nullable(),
});
export const withdrawEndorsementResponseSchema = successResponseSchema;
export const withdrawProposalResponseSchema = successResponseSchema;

export const listProposalsRouteSchema = {
  tags: ["Vote Proposals"],
  summary: "List open proposals in scope",
  request: { query: listProposalsQuerySchema },
  responses: {
    "200": {
      description: "Open proposals.",
      content: { "application/json": { schema: listProposalsResponseSchema } },
    },
  },
};

export const proposalDetailRouteSchema = {
  tags: ["Vote Proposals"],
  summary: "Proposal detail + current endorser list",
  request: { params: proposalIdParamsSchema },
  responses: {
    "200": {
      description: "Proposal detail.",
      content: {
        "application/json": { schema: proposalDetailResponseSchema },
      },
    },
    "404": { description: "Proposal not found." },
  },
};

export const endorseProposalRouteSchema = {
  tags: ["Vote Proposals"],
  summary: "Endorse a proposal (A–G members only)",
  description: "Auto-converts the proposal into an active vote once its endorsement threshold is reached.",
  request: { params: proposalIdParamsSchema },
  responses: {
    "200": {
      description: "Endorsement recorded.",
      content: {
        "application/json": {
          schema: endorseProposalResponseSchema,
        },
      },
    },
    "403": { description: "Not an A–G member, or not a member of the target working group." },
    "409": { description: "Proposal is not open for endorsement." },
  },
};
export const withdrawEndorsementRouteSchema = {
  tags: ["Vote Proposals"],
  summary: "Withdraw my own endorsement",
  request: { params: proposalIdParamsSchema },
  responses: {
    "200": {
      description: "Endorsement withdrawn.",
      content: { "application/json": { schema: withdrawEndorsementResponseSchema } },
    },
  },
};

export const withdrawProposalRouteSchema = {
  tags: ["Vote Proposals"],
  summary: "Withdraw my own proposal (proposer only)",
  request: { params: proposalIdParamsSchema },
  responses: {
    "200": {
      description: "Proposal withdrawn.",
      content: { "application/json": { schema: withdrawProposalResponseSchema } },
    },
    "403": { description: "Not the proposer." },
    "409": { description: "Only an open proposal can be withdrawn." },
  },
};
