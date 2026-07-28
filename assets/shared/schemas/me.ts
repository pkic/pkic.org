/**
 * Member self-service (PRD §4.9, §4.10). All endpoints operate on the
 * caller's own identity, resolved from a member session — never a
 * target-user path parameter.
 */
import { z } from "zod";

export const myOrganizationRepresentativeSchema = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
  email: z.string(),
  isPrimaryContact: z.boolean(),
  isSecondaryContact: z.boolean(),
});

export const myProfileSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  preferredName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: z.array(z.string()),
  membershipCategory: z.string(),
  organizationId: z.uuid().nullable(),
  organizationName: z.string().nullable(),
  memberSince: z.string(),
  showOnOrgProfile: z.boolean(),
  headshotUrl: z.string().nullable(),
  canEditOrganizationName: z.boolean(),
  // Member portal (self-service coworker enrollment): true when this member
  // is their organization's primary or secondary contact. Always false for
  // org-less (H5/H6/H7) members.
  isOrgContact: z.boolean(),
  // Full representative roster for the caller's organization, or null when
  // the member has no organization.
  organizationRepresentatives: z.array(myOrganizationRepresentativeSchema).nullable(),
});

export const myProfileGetRouteSchema = {
  tags: ["Me"],
  summary: "Get my profile (PRD §4.10)",
  responses: {
    "200": { description: "My profile.", content: { "application/json": { schema: myProfileSchema } } },
  },
};

export const myProfileUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  preferredName: z.string().trim().max(120).optional(),
  jobTitle: z.string().trim().max(160).optional(),
  biography: z.string().trim().max(5000).optional(),
  links: z.array(z.url()).max(15).optional(),
  organizationName: z.string().trim().max(200).optional(),
});

export const myProfileUpdateRouteSchema = {
  tags: ["Me"],
  summary: "Update my profile (PRD §4.10)",
  description: "organizationName is only honored for org-less categories (H5/H6/H7); ignored otherwise.",
  request: {
    body: { content: { "application/json": { schema: myProfileUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Updated profile.", content: { "application/json": { schema: myProfileSchema } } },
  },
};

export const myApplicationsListRouteSchema = {
  tags: ["Me"],
  summary: "My application history (PRD §4.10)",
  responses: {
    "200": {
      description: "My applications.",
      content: {
        "application/json": {
          schema: z.object({
            applications: z.array(
              z.object({
                id: z.string(),
                status: z.string(),
                stage: z.string(),
                membershipCategory: z.string(),
                createdAt: z.string(),
              }),
            ),
          }),
        },
      },
    },
  },
};

export const myApplicationTimelineEntrySchema = z.object({
  fromStage: z.string().nullable(),
  toStage: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

export const myApplicationCommunicationEntrySchema = z.object({
  subject: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});

export const myApplicationDetailSchema = z.object({
  id: z.string(),
  applicantName: z.string(),
  applicantEmail: z.string(),
  organizationName: z.string().nullable(),
  membershipCategory: z.string(),
  status: z.string(),
  stage: z.string(),
  stageEnteredAt: z.string(),
  createdAt: z.string(),
  timeline: z.array(myApplicationTimelineEntrySchema),
  communications: z.array(myApplicationCommunicationEntrySchema),
});

export const myApplicationDetailRouteSchema = {
  tags: ["Me"],
  summary: "My application detail: original application, status history, and timeline (PRD §4.10, §11 UI-1)",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": { description: "My application.", content: { "application/json": { schema: myApplicationDetailSchema } } },
    "404": { description: "Not found, or does not belong to the caller." },
  },
};

export const myVoteHistoryEntrySchema = z.object({
  voteId: z.uuid(),
  slug: z.string(),
  title: z.string(),
  voteType: z.string(),
  scopeType: z.string(),
  status: z.string(),
  choice: z.string(),
  submittedAt: z.string(),
});

export const myVotesListRouteSchema = {
  tags: ["Me"],
  summary: "My vote history (PRD §4.10)",
  description: "Every ballot the caller has cast, most recent first (PRD §4.8, Phase 4B).",
  responses: {
    "200": {
      description: "My votes.",
      content: { "application/json": { schema: z.object({ votes: z.array(myVoteHistoryEntrySchema) }) } },
    },
  },
};

export const myOrganizationVisibilityUpdateSchema = z.object({
  showOnOrgProfile: z.boolean(),
});

export const myOrganizationVisibilityUpdateRouteSchema = {
  tags: ["Me"],
  summary: "Toggle whether I appear on my organization's public page (PRD §4.10)",
  request: {
    body: { content: { "application/json": { schema: myOrganizationVisibilityUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Updated." },
  },
};

export const myWorkingGroupSummarySchema = z.object({
  workingGroupId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  joinedAt: z.string(),
});

export const myWorkingGroupsListRouteSchema = {
  tags: ["Me"],
  summary: "List my working group memberships (PRD §4.9)",
  responses: {
    "200": {
      description: "My working groups.",
      content: { "application/json": { schema: z.object({ workingGroups: z.array(myWorkingGroupSummarySchema) }) } },
    },
  },
};

export const myWorkingGroupJoinRouteSchema = {
  tags: ["Me"],
  summary: "Join a working group (PRD §4.9)",
  request: { params: z.object({ wgId: z.string() }) },
  responses: {
    "200": { description: "Joined." },
    "403": { description: "CA working group requires category A membership." },
    "404": { description: "Working group not found." },
  },
};

export const myWorkingGroupLeaveRouteSchema = {
  tags: ["Me"],
  summary: "Leave a working group (PRD §4.9)",
  request: { params: z.object({ wgId: z.string() }) },
  responses: {
    "200": { description: "Left." },
    "404": { description: "Working group not found." },
  },
};

export const addCoworkerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().email(),
});

export const addCoworkerRouteSchema = {
  tags: ["Me"],
  summary: "Enroll a coworker as a representative of my organization (self-service)",
  description:
    "Only the organization's primary or secondary contact may call this. The new member's category is inherited from the organization's own membership_category.",
  request: {
    body: { content: { "application/json": { schema: addCoworkerSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Coworker enrolled.",
      content: {
        "application/json": {
          schema: z.object({
            memberId: z.string(),
            userId: z.string(),
            name: z.string(),
            email: z.string(),
          }),
        },
      },
    },
    "403": { description: "Caller is not an org contact, or has no organization." },
    "409": { description: "Email already holds an active membership, or the org has no membership category set." },
  },
};

// ── Organization profile & content moderation (PRD §4.11) ────────────────

export const myOrganizationProfileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  contentMarkdown: z.string().nullable(),
  slogan: z.string().nullable(),
  logoUrl: z.string().nullable(),
  blogUrl: z.string().nullable(),
  blogFeedUrl: z.string().nullable(),
  pressUrl: z.string().nullable(),
  pressFeedUrl: z.string().nullable(),
  careersUrl: z.string().nullable(),
  socialX: z.string().nullable(),
  socialLinkedin: z.string().nullable(),
  socialFacebook: z.string().nullable(),
  socialInstagram: z.string().nullable(),
  socialYoutube: z.string().nullable(),
  isOrgContact: z.boolean(),
  isPrimaryContact: z.boolean(),
  pendingSecondaryContactUserId: z.uuid().nullable(),
  votingDelegateUserId: z.uuid().nullable(),
  pendingReview: z.record(z.string(), z.unknown()).nullable(),
});

export const myOrganizationProfileGetRouteSchema = {
  tags: ["Me"],
  summary: "View my organization's current live profile (PRD §4.11)",
  responses: {
    "200": {
      description: "My organization's profile.",
      content: { "application/json": { schema: myOrganizationProfileSchema } },
    },
    "403": { description: "Caller has no organization." },
  },
};

export const myOrganizationContentChangeSchema = z.object({
  slogan: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  contentMarkdown: z.string().trim().max(20000).nullable().optional(),
  website: z.url().nullable().optional(),
  blogUrl: z.url().nullable().optional(),
  blogFeedUrl: z.url().nullable().optional(),
  pressUrl: z.url().nullable().optional(),
  pressFeedUrl: z.url().nullable().optional(),
  careersUrl: z.url().nullable().optional(),
  socialX: z.url().nullable().optional(),
  socialLinkedin: z.url().nullable().optional(),
  socialFacebook: z.url().nullable().optional(),
  socialInstagram: z.url().nullable().optional(),
  socialYoutube: z.url().nullable().optional(),
});

export const myOrganizationContentChangeRouteSchema = {
  tags: ["Me"],
  summary: "Submit an organization content change for staff review (PRD §4.11)",
  description:
    "Only the org's primary or secondary contact may call this. Queues the change in the moderation queue — the live profile is unchanged until a staff admin approves it. Only one pending submission per organization at a time.",
  request: {
    body: { content: { "application/json": { schema: myOrganizationContentChangeSchema } }, required: true },
  },
  responses: {
    "200": { description: "Submitted for review." },
    "403": { description: "Caller is not an org contact, or has no organization." },
    "409": { description: "A submission is already pending review." },
    "422": { description: "No editable fields were submitted." },
  },
};

export const myOrganizationReviewSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  submittedByUserId: z.uuid(),
  proposedChanges: z.record(z.string(), z.unknown()),
  hasLogoChange: z.boolean(),
  status: z.string(),
  reviewerUserId: z.uuid().nullable(),
  reviewerNote: z.string().nullable(),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable(),
});

export const myOrganizationReviewsListRouteSchema = {
  tags: ["Me"],
  summary: "Status of my organization's pending/past content submissions (PRD §4.11)",
  responses: {
    "200": {
      description: "My organization's review history.",
      content: { "application/json": { schema: z.object({ reviews: z.array(myOrganizationReviewSchema) }) } },
    },
    "403": { description: "Caller has no organization." },
  },
};

export const myOrganizationReviewWithdrawRouteSchema = {
  tags: ["Me"],
  summary: "Withdraw a pending organization content submission (PRD §4.11)",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    "200": { description: "Withdrawn." },
    "404": { description: "Review not found." },
    "409": { description: "Only a pending review can be withdrawn." },
  },
};

export const myOrganizationLogoUploadRouteSchema = {
  tags: ["Me"],
  summary: "Propose a new organization logo (PRD §4.11)",
  description:
    "multipart/form-data with a single 'file' field. Held in R2 staging and folds into the org's single pending content review until a staff admin approves it.",
  responses: {
    "200": { description: "Staged." },
    "403": { description: "Caller is not an org contact, or has no organization." },
    "413": { description: "File too large." },
    "415": { description: "Unsupported file type." },
  },
};

export const mySecondaryContactNominateSchema = z.object({
  userId: z.uuid().nullable(),
});

export const mySecondaryContactNominateRouteSchema = {
  tags: ["Me"],
  summary: "Nominate a secondary contact for my organization (PRD §4.11)",
  description:
    "Only the primary contact may call this. Held as a pending nomination (organizations.pending_secondary_contact_user_id) until a staff admin confirms it. Pass userId: null to withdraw a pending nomination.",
  request: {
    body: { content: { "application/json": { schema: mySecondaryContactNominateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Nomination recorded." },
    "403": { description: "Only the primary contact may nominate a secondary contact." },
    "422": {
      description: "Nominee is not an active member of the same organization, or is already the primary contact.",
    },
  },
};

export const myVotingDelegateUpdateSchema = z.object({
  userId: z.uuid().nullable(),
});

export const myVotingDelegateUpdateRouteSchema = {
  tags: ["Me"],
  summary: "Set my organization's standing forum-vote delegate (PRD §4.8)",
  description:
    "Only the org's primary or secondary contact may call this. Takes effect immediately (no staff confirmation). Pass userId: null to clear the override and fall back to the primary contact.",
  request: {
    body: { content: { "application/json": { schema: myVotingDelegateUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Voting delegate updated." },
    "403": { description: "Caller is not an org contact, or has no organization." },
    "422": { description: "Nominee is not an active member of the same organization." },
  },
};

export const myHeadshotUploadRouteSchema = {
  tags: ["Me"],
  summary: "Upload my headshot (PRD §4.10)",
  description: "multipart/form-data with a single 'file' field. JPEG, PNG, or WebP, up to 5MB.",
  responses: {
    "200": { description: "Uploaded." },
    "413": { description: "File too large." },
    "415": { description: "Unsupported file type." },
  },
};

// ── Notification preferences (PRD §7 Account Settings, §11 UI-1) ─────────

export const myNotificationPreferencesSchema = z.object({
  workingGroupUpdates: z.boolean(),
  voteReminders: z.boolean(),
  generalAnnouncements: z.boolean(),
});

export const myNotificationPreferencesGetRouteSchema = {
  tags: ["Me"],
  summary: "Get my email notification preferences (PRD §7, §11 UI-1)",
  responses: {
    "200": {
      description: "My notification preferences (all default to true/opted-in).",
      content: { "application/json": { schema: myNotificationPreferencesSchema } },
    },
  },
};

export const myNotificationPreferencesUpdateSchema = myNotificationPreferencesSchema.partial();

export const myNotificationPreferencesUpdateRouteSchema = {
  tags: ["Me"],
  summary: "Update my email notification preferences (PRD §7, §11 UI-1)",
  request: {
    body: { content: { "application/json": { schema: myNotificationPreferencesUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Updated preferences.",
      content: { "application/json": { schema: myNotificationPreferencesSchema } },
    },
  },
};

// ── Organization sponsorship view (PRD §4.13, Phase 4E) ────────────────────

export const myOrganizationSponsorshipSchema = z.object({
  tier: z.string().nullable(),
  startDate: z.string().nullable(),
});

export const myOrganizationSponsorshipGetRouteSchema = {
  tags: ["Me"],
  summary: "View my organization's active consortium sponsorship tier + start date",
  responses: {
    "200": {
      description: "Current sponsorship, or nulls if the organization is not currently a sponsor.",
      content: { "application/json": { schema: myOrganizationSponsorshipSchema } },
    },
  },
};
