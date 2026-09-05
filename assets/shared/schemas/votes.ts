/**
 * Voting system. Backs the public `/api/v1/votes*`
 * endpoints and group-scoped management surfaces.
 */
import { z } from "zod";
import { successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema, type PaginationDefaults } from "./pagination";
import { membershipCategorySelectionSchema } from "./membership-categories";
import { formFieldDefinitionSchema } from "./forms";
import { groupIdSchema } from "./groups";
import { publicOperation } from "./route-contract";

export const VOTE_TYPES = ["election", "motion", "consultation"] as const;
export const voteTypeSchema = z.enum(VOTE_TYPES);
export type VoteType = z.infer<typeof voteTypeSchema>;

export const VOTE_ELECTORATE_MODES = ["per_member", "per_person"] as const;
export const voteElectorateModeSchema = z.enum(VOTE_ELECTORATE_MODES);

export const THRESHOLD_TYPES = ["simple_majority", "supermajority", "successive_elimination"] as const;
export const thresholdTypeSchema = z.enum(THRESHOLD_TYPES);

export const VOTE_VISIBILITIES = ["private", "public"] as const;
export const voteVisibilitySchema = z.enum(VOTE_VISIBILITIES);

export const PUBLIC_DETAIL_LEVELS = ["outcome_only", "aggregate", "full_breakdown"] as const;
export const publicDetailLevelSchema = z.enum(PUBLIC_DETAIL_LEVELS);

export const VOTE_STATUSES = ["scheduled", "open", "closed", "cancelled"] as const;
export const voteStatusSchema = z.enum(VOTE_STATUSES);
/** Derived from the vote schedule and lifecycle facts; never stored. */
export type VoteStatus = z.infer<typeof voteStatusSchema>;

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

/**
 * The consultation's form, in the same projection every other form uses, so
 * the portal renders it with the ordinary form components rather than a
 * second field renderer that would drift from them.
 */
export const consultationFormSchema = z.object({
  id: databaseIdSchema,
  title: z.string(),
  description: z.string().nullable(),
  fields: z.array(formFieldDefinitionSchema),
});

export const consultationQuestionResultSchema = z.object({
  fieldId: databaseIdSchema,
  key: z.string(),
  label: z.string(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  leadingOption: z.string().nullable(),
  answered: z.number().int().nonnegative(),
});

export const consultationVoteResultSchema = z.object({
  formId: databaseIdSchema,
  questions: z.array(consultationQuestionResultSchema),
  totalResponses: z.number().int().nonnegative(),
  quorum: z.lazy(() => voteQuorumSchema).nullable(),
  quorumMet: z.boolean(),
});

export const voteQuorumSchema = z.object({
  percent: z.number().int().min(1).max(100),
  eligible: z.number().int().nonnegative(),
  required: z.number().int().nonnegative(),
  met: z.boolean(),
});

export const voteCastingVoteSchema = z.object({
  role: z.enum(["lead", "deputy_lead"]),
  choice: z.enum(["in_favor", "opposed"]),
});

export const motionVoteResultSchema = z.object({
  thresholdType: thresholdTypeSchema.extract(["simple_majority", "supermajority"]),
  counts: voteBallotCountsSchema,
  totalBallots: z.number().int().nonnegative(),
  /** Null unless the vote opted into a turnout floor. */
  quorum: voteQuorumSchema.nullable().default(null),
  /** Set only when a tie was settled by the chair's ballot counting twice. */
  castingVote: voteCastingVoteSchema.nullable().default(null),
  /**
   * `not_quorate` means the question was not settled, which is materially
   * different from being rejected.
   */
  outcome: z.enum(["passed", "failed", "not_quorate"]),
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
export const voteFullResultSchema = z.union([
  motionVoteResultSchema,
  electionVoteResultSchema,
  consultationVoteResultSchema,
]);

/**
 * Redacted shape returned when a public vote's publicDetailLevel is
 * 'outcome_only' — see votes/public.ts's publicResultForDetailLevel.
 */
export const voteOutcomeOnlyResultSchema = z.object({ outcome: z.string().nullable() });

/**
 * result as returned by public and member-scoped list/detail endpoints: null
 * before close, or — for public endpoints — outcome-only or the full
 * shape depending on the vote's publicDetailLevel (member endpoints
 * always return the full shape, never outcome-only).
 */
// Parse full results first. Zod object schemas strip unknown keys by default,
// so putting the smaller outcome-only projection first would silently discard
// counts/rounds from otherwise valid closed-vote responses.
export const voteResultSchema = z.union([voteFullResultSchema, voteOutcomeOnlyResultSchema]).nullable();

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
  ownerGroupId: groupIdSchema,
  ownerGroupName: z.string(),
  electorateMode: voteElectorateModeSchema,
  thresholdType: thresholdTypeSchema,
  questionFormId: databaseIdSchema.nullable().default(null),
  quorumPercent: z.number().int().min(1).max(100).nullable().default(null),
  tieBreakMode: z.enum(["none", "chair"]).default("none"),
  excludedMemberIds: z.array(databaseIdSchema).max(200).nullable().default(null),
  eligibleCategories: membershipCategorySelectionSchema.nullable(),
  opensAt: z.string(),
  closesAt: z.string(),
  currentRound: z.number(),
  status: voteStatusSchema,
  cancellationReason: z.string().nullable().default(null),
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

export const eligibleMemberBallotSchema = z.object({
  memberId: databaseIdSchema,
  organizationName: z.string(),
  hasCastBallot: z.boolean(),
});

export const memberVoteSchema = z.object({
  ...voteSummaryFieldsSchema,
  candidates: z.array(candidateSummarySchema).nullable(),
  canCastBallot: z.boolean(),
  hasCastBallot: z.boolean(),
  memberBallots: z.array(eligibleMemberBallotSchema).nullable(),
  /** Present only for a consultation that asks a form. */
  questionForm: consultationFormSchema.nullable().default(null),
  result: voteResultSchema,
});

export const publicVotesListResponseSchema = paginatedResponseSchema("votes", publicVoteSchema);
export type PublicVotesListResponse = z.infer<typeof publicVotesListResponseSchema>;

export const publicVoteGetResponseSchema = z.object({ vote: publicVoteSchema });
export type PublicVoteGetResponse = z.infer<typeof publicVoteGetResponseSchema>;

/** `GET /api/v1/users/current/votes` — the self-participation projection over `memberVoteSchema`. */
export const currentUserVotesListResponseSchema = paginatedResponseSchema("votes", memberVoteSchema);
export type CurrentUserVotesListResponse = z.infer<typeof currentUserVotesListResponseSchema>;

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
const voteStatusFilterSchema = voteStatusListSchema([...VOTE_STATUSES]);

export const VOTES_LIST_SORT_COLUMNS = ["title", "status", "closes_at", "created_at"] as const;

function votesListQuerySchemaWithDefaults(defaults: PaginationDefaults = {}) {
  return listQuerySchema(VOTES_LIST_SORT_COLUMNS, defaults).extend({
    type: voteTypeSchema.optional(),
    ownerGroupId: groupIdSchema.optional(),
    status: voteStatusFilterSchema.optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  });
}

export const votesListQuerySchema = votesListQuerySchemaWithDefaults();
export type VotesListQuery = z.infer<typeof votesListQuerySchema>;

/** Public-page validation composes the same filters with its bounded default and status policy. */
export const publicVotesListQuerySchema = votesListQuerySchemaWithDefaults({ limit: 20 }).extend({
  status: publicVoteStatusListSchema.optional(),
});
export type PublicVotesListQuery = z.infer<typeof publicVotesListQuerySchema>;

export const publicVotesListRouteSchema = {
  ...publicOperation(),
  tags: ["Votes"],
  summary: "List public votes",
  description:
    "Public cross-group projection. Member participation and private vote access use the owning group's vote resources. Filtering, sorting, counting, and pagination run in D1.",
  request: { query: publicVotesListQuerySchema },
  responses: {
    "200": {
      description: "A bounded page of public votes.",
      content: { "application/json": { schema: publicVotesListResponseSchema } },
    },
  },
};

export const voteSlugParamsSchema = z.object({ slug: z.string().trim().min(1).max(300) });

export const publicVoteGetRouteSchema = {
  ...publicOperation(),
  tags: ["Votes"],
  summary: "Get public vote detail",
  description: "Private vote existence and member ballot state are never exposed by this public projection.",
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
  ...publicOperation(),
  tags: ["Votes"],
  summary: "RSS feed of public votes",
  responses: {
    "200": { description: "RSS/Atom XML document." },
  },
};

export const submitBallotSchema = z.object({
  memberId: databaseIdSchema.nullable().optional(),
  choice: z.string().trim().min(1).max(100),
});
export const submitBallotResponseSchema = successResponseSchema;

/**
 * A consultation is answered with the form's own answers, keyed by field, so
 * the payload is the same shape every other form submission uses.
 */
export const submitConsultationResponseSchema = z.object({
  memberId: databaseIdSchema.nullable().optional(),
  answers: z.record(z.string(), z.unknown()),
});
export const submitConsultationResponseResponseSchema = successResponseSchema;

// ── Vote proposals (authenticated voting-category members) ──────────

export const proposalSummarySchema = z.object({
  id: databaseIdSchema,
  title: z.string(),
  description: z.string(),
  voteType: voteTypeSchema,
  ownerGroupId: groupIdSchema,
  ownerGroupName: z.string(),
  proposedByUserId: databaseIdSchema,
  eligibleCategories: membershipCategorySelectionSchema.nullable(),
  proposedOpensAt: z.string().nullable(),
  proposedClosesAt: z.string().nullable(),
  status: voteProposalStatusSchema,
  voteId: databaseIdSchema.nullable(),
  rejectionReason: z.string().nullable(),
  endorsementCount: z.number(),
  minEndorsersRequired: z.number(),
  createdAt: z.string(),
});
export type ProposalSummary = z.infer<typeof proposalSummarySchema>;

const voteProposalInputShape = {
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(10000),
  voteType: voteTypeSchema.exclude(["election"]),
  eligibleCategories: membershipCategorySelectionSchema.nullable().optional(),
  proposedOpensAt: z.iso.datetime({ offset: true }).nullable().optional(),
  proposedClosesAt: z.iso.datetime({ offset: true }).nullable().optional(),
};

function addVoteProposalWindowIssue(
  value: { proposedOpensAt?: string | null; proposedClosesAt?: string | null },
  context: z.RefinementCtx,
): void {
  if (value.proposedOpensAt && value.proposedClosesAt && value.proposedClosesAt <= value.proposedOpensAt) {
    context.addIssue({
      code: "custom",
      path: ["proposedClosesAt"],
      message: "Proposed closing time must be after the proposed opening time",
    });
  }
}

export const voteProposalFieldsSchema = z.object(voteProposalInputShape).superRefine(addVoteProposalWindowIssue);

export const VOTE_PROPOSALS_LIST_SORT_COLUMNS = ["title", "status", "endorsement_count", "created_at"] as const;

export const listProposalsQuerySchema = listQuerySchema(VOTE_PROPOSALS_LIST_SORT_COLUMNS).extend({
  ownerGroupId: groupIdSchema.optional(),
  status: voteProposalStatusSchema.optional(),
});
export type ListProposalsQuery = z.infer<typeof listProposalsQuerySchema>;

export const proposalDetailResponseSchema = z.object({
  proposal: proposalSummarySchema,
  endorserUserIds: z.array(databaseIdSchema),
});

export const endorseProposalResponseSchema = z.object({
  proposal: proposalSummarySchema,
  convertedVote: z.object(voteSummaryFieldsSchema).nullable(),
});
export const voteProposalRejectSchema = z.object({ reason: z.string().trim().min(1).max(2000) });
