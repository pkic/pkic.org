/**
 * Member portal client-side types. Five of these (OrganizationRepresentative,
 * MyProfile, MyProfileUpdateInput, Passkey, NotificationPreferences) are
 * z.infer<> types from the shared Zod schemas — the isomorphic API
 * contract — instead of hand-mirrored interfaces, so a schema change can't
 * silently drift from what the portal actually sends/expects (PR #1
 * review). The rest of this file has no corresponding request/response
 * schema (yet) and stays hand-written.
 */
import type { z } from "zod";
import type {
  myOrganizationRepresentativeSchema,
  myProfileSchema,
  myProfileUpdateSchema,
  myNotificationPreferencesSchema,
} from "../../../shared/schemas/me";
import type { passkeySummarySchema } from "../../../shared/schemas/passkeys";

export type OrganizationRepresentative = z.infer<typeof myOrganizationRepresentativeSchema>;
export type MyProfile = z.infer<typeof myProfileSchema>;
export type MyProfileUpdateInput = z.infer<typeof myProfileUpdateSchema>;
export type Passkey = z.infer<typeof passkeySummarySchema>;
export type NotificationPreferences = z.infer<typeof myNotificationPreferencesSchema>;

export interface MyApplicationSummary {
  id: string;
  status: string;
  stage: string;
  membershipCategory: string;
  createdAt: string;
}

export interface MyApplicationTimelineEntry {
  fromStage: string | null;
  toStage: string;
  note: string | null;
  createdAt: string;
}

export interface MyApplicationCommunicationEntry {
  subject: string | null;
  body: string;
  createdAt: string;
}

export interface MyApplicationDetail {
  id: string;
  applicantName: string;
  applicantEmail: string;
  organizationName: string | null;
  membershipCategory: string;
  status: string;
  stage: string;
  stageEnteredAt: string;
  createdAt: string;
  timeline: MyApplicationTimelineEntry[];
  communications: MyApplicationCommunicationEntry[];
}

export interface MyOrganizationReview {
  id: string;
  organizationId: string;
  submittedByUserId: string;
  proposedChanges: Record<string, unknown>;
  hasLogoChange: boolean;
  status: string;
  reviewerUserId: string | null;
  reviewerNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}

export interface MyOrganizationProfile {
  id: string;
  name: string;
  description: string | null;
  website: string | null;
  contentMarkdown: string | null;
  slogan: string | null;
  logoUrl: string | null;
  blogUrl: string | null;
  blogFeedUrl: string | null;
  pressUrl: string | null;
  pressFeedUrl: string | null;
  careersUrl: string | null;
  links: string[];
  isOrgContact: boolean;
  isPrimaryContact: boolean;
  pendingSecondaryContactUserId: string | null;
  votingDelegateUserId: string | null;
  pendingReview: MyOrganizationReview | null;
}

export interface MyOrganizationSponsorship {
  tier: string | null;
  startDate: string | null;
}

export interface WorkingGroupSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
}

export interface MyWorkingGroupMembership {
  workingGroupId: string;
  slug: string;
  name: string;
  joinedAt: string;
}

export interface MyMeetingSeriesIcsFile {
  id: string;
  label: string;
  year: number;
}

export interface MyMeetingSeries {
  id: string;
  name: string;
  scopeType: "consortium" | "working_group";
  icsFiles: MyMeetingSeriesIcsFile[];
  preferenceIcsFileId: string | null;
}

export type VoteType = "election" | "motion" | "consultation";
export type VoteScopeType = "forum" | "working_group";

export interface VoteCandidate {
  id: string;
  userId: string | null;
  candidateName: string;
  candidateBio: string | null;
  sortOrder: number;
  eliminatedRound: number | null;
}

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

export interface PortalVote {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  voteType: VoteType;
  scopeType: VoteScopeType;
  scopeId: string | null;
  thresholdType: string;
  eligibleCategories: string[] | null;
  opensAt: string;
  closesAt: string;
  currentRound: number;
  status: string;
  visibility: string;
  publicDetailLevel: string;
  createdAt: string;
  updatedAt: string;
  candidates: VoteCandidate[] | null;
  canCastBallot: boolean;
  hasCastBallot: boolean;
  result: MotionVoteResult | ElectionVoteResult | null;
}

export interface VoteProposal {
  id: string;
  title: string;
  description: string;
  voteType: VoteType;
  scopeType: VoteScopeType;
  scopeId: string | null;
  proposedByUserId: string;
  status: string;
  voteId: string | null;
  rejectionReason: string | null;
  endorsementCount: number;
  minEndorsersRequired: number;
  createdAt: string;
}
