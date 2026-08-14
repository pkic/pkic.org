/**
 * Member portal client-side types. All but three of these are z.infer<>
 * types from the shared Zod schemas — the isomorphic API contract —
 * instead of hand-mirrored interfaces, so a schema change can't silently
 * drift from what the portal actually sends/expects (PR #1 review).
 *
 * The three exceptions (MotionVoteResult, ElectionRoundTally,
 * ElectionVoteResult) stay hand-written: the backend schema deliberately
 * types vote `result` as `z.unknown()` (an opaque JSON field whose shape
 * depends on voteType), so there's no schema to infer a specific shape
 * from. PortalVote overrides just that one field after inferring
 * everything else from portalVoteSchema.
 */
import type { z } from "zod";
import type {
  myOrganizationRepresentativeSchema,
  myProfileSchema,
  myProfileUpdateSchema,
  myNotificationPreferencesSchema,
  myApplicationSummarySchema,
  myApplicationTimelineEntrySchema,
  myApplicationCommunicationEntrySchema,
  myApplicationDetailSchema,
  myOrganizationReviewSchema,
  myOrganizationProfileSchema,
  myOrganizationSponsorshipSchema,
  myWorkingGroupSummarySchema,
} from "../../../shared/schemas/me";
import type { passkeySummarySchema } from "../../../shared/schemas/passkeys";
import type { workingGroupSummarySchema } from "../../../shared/schemas/members-directory";
import type { myMeetingSeriesIcsFileSchema, myMeetingSeriesSchema } from "../../../shared/schemas/meeting-calendar";
import type {
  voteTypeSchema,
  voteScopeTypeSchema,
  candidateSummarySchema,
  portalVoteSchema,
  proposalSummarySchema,
} from "../../../shared/schemas/votes";

export type OrganizationRepresentative = z.infer<typeof myOrganizationRepresentativeSchema>;
export type MyProfile = z.infer<typeof myProfileSchema>;
export type MyProfileUpdateInput = z.infer<typeof myProfileUpdateSchema>;
export type Passkey = z.infer<typeof passkeySummarySchema>;
export type NotificationPreferences = z.infer<typeof myNotificationPreferencesSchema>;

export type MyApplicationSummary = z.infer<typeof myApplicationSummarySchema>;
export type MyApplicationTimelineEntry = z.infer<typeof myApplicationTimelineEntrySchema>;
export type MyApplicationCommunicationEntry = z.infer<typeof myApplicationCommunicationEntrySchema>;
export type MyApplicationDetail = z.infer<typeof myApplicationDetailSchema>;
export type MyOrganizationReview = z.infer<typeof myOrganizationReviewSchema>;
export type MyOrganizationProfile = z.infer<typeof myOrganizationProfileSchema>;
export type MyOrganizationSponsorship = z.infer<typeof myOrganizationSponsorshipSchema>;

export type WorkingGroupSummary = z.infer<typeof workingGroupSummarySchema>;
export type MyWorkingGroupMembership = z.infer<typeof myWorkingGroupSummarySchema>;

export type MyMeetingSeriesIcsFile = z.infer<typeof myMeetingSeriesIcsFileSchema>;
export type MyMeetingSeries = z.infer<typeof myMeetingSeriesSchema>;

export type VoteType = z.infer<typeof voteTypeSchema>;
export type VoteScopeType = z.infer<typeof voteScopeTypeSchema>;
export type VoteCandidate = z.infer<typeof candidateSummarySchema>;

export interface MotionVoteResult {
  thresholdType: string;
  counts: { in_favor: number; opposed: number; abstain: number };
  totalBallots: number;
  outcome: "passed" | "failed";
}

export interface ElectionRoundTally {
  round: number;
  counts: Record<string, number>;
  eliminatedCandidateIds: string[];
  winnerCandidateId: string | null;
}

export interface ElectionVoteResult {
  rounds: ElectionRoundTally[];
  winnerCandidateId: string | null;
}

export type PortalVote = Omit<z.infer<typeof portalVoteSchema>, "result"> & {
  result: MotionVoteResult | ElectionVoteResult | null;
};

export type VoteProposal = z.infer<typeof proposalSummarySchema>;
