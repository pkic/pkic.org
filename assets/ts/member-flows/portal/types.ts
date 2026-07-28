/**
 * Member portal client-side types — mirror assets/shared/schemas/me.ts and
 * assets/shared/schemas/passkeys.ts. Small duplication of the server's
 * shapes rather than importing the zod schemas directly, matching this
 * codebase's existing precedent (see admin/types.ts's own Passkey type).
 */

export interface OrganizationRepresentative {
  userId: string;
  name: string | null;
  email: string;
  isPrimaryContact: boolean;
  isSecondaryContact: boolean;
}

export interface MyProfile {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  jobTitle: string | null;
  biography: string | null;
  links: string[];
  membershipCategory: string;
  organizationId: string | null;
  organizationName: string | null;
  memberSince: string;
  showOnOrgProfile: boolean;
  headshotUrl: string | null;
  canEditOrganizationName: boolean;
  isOrgContact: boolean;
  organizationRepresentatives: OrganizationRepresentative[] | null;
}

export interface MyProfileUpdateInput {
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  jobTitle?: string;
  biography?: string;
  links?: string[];
  organizationName?: string;
}

export interface Passkey {
  id: string;
  deviceName: string | null;
  aaguid: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  workingGroupUpdates: boolean;
  voteReminders: boolean;
  generalAnnouncements: boolean;
}

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
  socialX: string | null;
  socialLinkedin: string | null;
  socialFacebook: string | null;
  socialInstagram: string | null;
  socialYoutube: string | null;
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
