/**
 * Member portal client-side types. These are z.infer<> types from the
 * shared Zod schemas — the isomorphic API contract — instead of
 * hand-mirrored interfaces, so a schema change can't silently drift from
 * what the portal actually sends/expects (PR #1 review).
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
} from "../../../shared/schemas/me";
import type {
  voteTypeSchema,
  candidateSummarySchema,
  portalVoteSchema,
  proposalSummarySchema,
  motionVoteResultSchema,
  electionRoundTallySchema,
  electionVoteResultSchema,
} from "../../../shared/schemas/votes";
import type { userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";

export type OrganizationRepresentative = z.infer<typeof myOrganizationRepresentativeSchema>;
export type MyProfile = z.infer<typeof myProfileSchema>;
export type MyProfileUpdateInput = z.infer<typeof myProfileUpdateSchema>;
export type NotificationPreferences = z.infer<typeof myNotificationPreferencesSchema>;
export type PortalSession = z.infer<typeof userAuthSessionResponseSchema>;

export type MyApplicationSummary = z.infer<typeof myApplicationSummarySchema>;
export type MyApplicationTimelineEntry = z.infer<typeof myApplicationTimelineEntrySchema>;
export type MyApplicationCommunicationEntry = z.infer<typeof myApplicationCommunicationEntrySchema>;
export type MyApplicationDetail = z.infer<typeof myApplicationDetailSchema>;
export type MyOrganizationReview = z.infer<typeof myOrganizationReviewSchema>;
export type MyOrganizationProfile = z.infer<typeof myOrganizationProfileSchema>;
export type MyOrganizationSponsorship = z.infer<typeof myOrganizationSponsorshipSchema>;

export type VoteType = z.infer<typeof voteTypeSchema>;
export type VoteCandidate = z.infer<typeof candidateSummarySchema>;

export type MotionVoteResult = z.infer<typeof motionVoteResultSchema>;
export type ElectionRoundTally = z.infer<typeof electionRoundTallySchema>;
export type ElectionVoteResult = z.infer<typeof electionVoteResultSchema>;

export type PortalVote = z.infer<typeof portalVoteSchema>;

export type VoteProposal = z.infer<typeof proposalSummarySchema>;
