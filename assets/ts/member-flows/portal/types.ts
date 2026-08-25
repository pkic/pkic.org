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
import type { myMeetingSeriesIcsFileSchema, myMeetingSeriesSchema } from "../../../shared/schemas/meeting-calendar";
import type { PageInfo } from "../../../shared/schemas/pagination";
import type {
  voteTypeSchema,
  voteScopeTypeSchema,
  candidateSummarySchema,
  portalVoteSchema,
  proposalSummarySchema,
  motionVoteResultSchema,
  electionRoundTallySchema,
  electionVoteResultSchema,
} from "../../../shared/schemas/votes";

export type OrganizationRepresentative = z.infer<typeof myOrganizationRepresentativeSchema>;
export type MyProfile = z.infer<typeof myProfileSchema>;
export type MyProfileUpdateInput = z.infer<typeof myProfileUpdateSchema>;
export type NotificationPreferences = z.infer<typeof myNotificationPreferencesSchema>;

export type MyApplicationSummary = z.infer<typeof myApplicationSummarySchema>;
export type MyApplicationTimelineEntry = z.infer<typeof myApplicationTimelineEntrySchema>;
export type MyApplicationCommunicationEntry = z.infer<typeof myApplicationCommunicationEntrySchema>;
export type MyApplicationDetail = z.infer<typeof myApplicationDetailSchema>;
export type MyOrganizationReview = z.infer<typeof myOrganizationReviewSchema>;
export type MyOrganizationProfile = z.infer<typeof myOrganizationProfileSchema>;
export type MyOrganizationSponsorship = z.infer<typeof myOrganizationSponsorshipSchema>;

export type MyMeetingSeriesIcsFile = z.infer<typeof myMeetingSeriesIcsFileSchema>;
export type MyMeetingSeries = z.infer<typeof myMeetingSeriesSchema>;
export type MyMeetingSeriesPageInfo = PageInfo;

export type VoteType = z.infer<typeof voteTypeSchema>;
export type VoteScopeType = z.infer<typeof voteScopeTypeSchema>;
export type VoteCandidate = z.infer<typeof candidateSummarySchema>;

export type MotionVoteResult = z.infer<typeof motionVoteResultSchema>;
export type ElectionRoundTally = z.infer<typeof electionRoundTallySchema>;
export type ElectionVoteResult = z.infer<typeof electionVoteResultSchema>;

export type PortalVote = z.infer<typeof portalVoteSchema>;

export type VoteProposal = z.infer<typeof proposalSummarySchema>;
