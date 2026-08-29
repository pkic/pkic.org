/**
 * Member self-service. All endpoints operate on the
 * caller's own identity, resolved from the shared human session — never a
 * target-user path parameter.
 */
import { z } from "zod";
import { successResponseSchema } from "./api-common";
import { httpOrSameOriginUrlSchema } from "./urls";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { applicationStageSchema } from "./member-applications";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import {
  contentReviewStatusSchema,
  organizationContentReviewSchema,
  organizationEditableContentSchema,
  organizationProfileContentFieldsSchema,
} from "./organization-profile";

export const myOrganizationRepresentativeSchema = z.object({
  userId: databaseIdSchema,
  name: z.string().nullable(),
  email: z.string(),
  showOnOrgProfile: z.boolean(),
  isPrimaryContact: z.boolean(),
  isSecondaryContact: z.boolean(),
});

// One membership context (own org-less membership, or an organization
// actively represented) a member can act as. A person can hold more than
// one at once — see functions/_lib/auth/user-session.ts.
export const myActiveMembershipSchema = z.object({
  memberId: databaseIdSchema,
  organizationId: databaseIdSchema.nullable(),
  organizationName: z.string().nullable(),
  membershipCategory: z.string(),
});

export const myProfileSchema = z.object({
  userId: databaseIdSchema,
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  preferredName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: linksSchema,
  membershipCategory: z.string(),
  organizationId: databaseIdSchema.nullable(),
  organizationName: z.string().nullable(),
  memberSince: z.string(),
  showOnOrgProfile: z.boolean(),
  headshotUrl: httpOrSameOriginUrlSchema.nullable(),
  canEditOrganizationName: z.boolean(),
  // Member portal (self-service coworker enrollment): true when this member
  // is their organization's primary or secondary contact. Always false for
  // org-less (H5/H6/H7) members.
  isOrgContact: z.boolean(),
  // Full representative roster for the caller's organization, or null when
  // the member has no organization.
  organizationRepresentatives: z.array(myOrganizationRepresentativeSchema).nullable(),
  // Every membership context this member is currently eligible to act
  // through. Always at least one entry (the one reflected in the fields
  // above); more than one only when the caller represents multiple
  // organizations (or an organization plus their own individual
  // membership) concurrently.
  activeMemberships: z.array(myActiveMembershipSchema).min(1),
});

export const myProfileGetRouteSchema = {
  tags: ["Me"],
  summary: "Get my profile",
  responses: {
    "200": { description: "My profile.", content: { "application/json": { schema: myProfileSchema } } },
  },
};

export const myActiveMembershipSwitchSchema = z.object({
  memberId: databaseIdSchema,
});

export const myActiveMembershipSwitchRouteSchema = {
  tags: ["Me"],
  summary: "Switch my active membership context",
  description:
    "Only meaningful for a user who represents more than one organization (or an organization plus an individual membership) concurrently. Re-verifies memberId against the caller's own live eligible memberships — a user can never select one they don't actually hold — then reissues the shared human session cookie scoped to it.",
  request: {
    body: { content: { "application/json": { schema: myActiveMembershipSwitchSchema } }, required: true },
  },
  responses: {
    "200": { description: "Switched.", content: { "application/json": { schema: myProfileSchema } } },
    "403": { description: "The caller does not actively hold this membership." },
  },
};

export const myProfileUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().min(1).max(120).optional(),
  preferredName: z.string().trim().max(120).optional(),
  jobTitle: z.string().trim().max(160).optional(),
  biography: z.string().trim().max(5000).optional(),
  links: linksSchema.optional(),
  organizationName: z.string().trim().max(200).optional(),
});

export const myProfileUpdateRouteSchema = {
  tags: ["Me"],
  summary: "Update my profile",
  description: "organizationName is only honored for org-less categories (H5/H6/H7); ignored otherwise.",
  request: {
    body: { content: { "application/json": { schema: myProfileUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Updated profile.", content: { "application/json": { schema: myProfileSchema } } },
  },
};

export const myApplicationSummarySchema = z.object({
  id: z.string(),
  stage: applicationStageSchema,
  membershipCategory: z.string(),
  createdAt: z.string(),
});

export const MY_APPLICATION_SORT_COLUMNS = ["createdAt", "stage"] as const;
export const myApplicationsListQuerySchema = listQuerySchema(MY_APPLICATION_SORT_COLUMNS, { limit: 25 });
export type MyApplicationsListQuery = z.infer<typeof myApplicationsListQuerySchema>;
export const myApplicationsListResponseSchema = paginatedResponseSchema("applications", myApplicationSummarySchema);

export const myApplicationsListRouteSchema = {
  tags: ["Me"],
  summary: "My application history",
  request: { query: myApplicationsListQuerySchema },
  responses: {
    "200": {
      description: "My applications.",
      content: {
        "application/json": {
          schema: myApplicationsListResponseSchema,
        },
      },
    },
  },
};

export const myApplicationTimelineEntrySchema = z.object({
  fromStage: applicationStageSchema.nullable(),
  toStage: applicationStageSchema,
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
  stage: applicationStageSchema,
  stageEnteredAt: z.string(),
  createdAt: z.string(),
  timeline: z.array(myApplicationTimelineEntrySchema),
  communications: z.array(myApplicationCommunicationEntrySchema),
});

export const myApplicationDetailRouteSchema = {
  tags: ["Me"],
  summary: "My application detail: original application, status history, and timeline",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": { description: "My application.", content: { "application/json": { schema: myApplicationDetailSchema } } },
    "404": { description: "Not found, or does not belong to the caller." },
  },
};

export const myOrganizationVisibilityUpdateSchema = z.object({
  showOnOrgProfile: z.boolean(),
});
export const myOrganizationVisibilityUpdateResponseSchema = successResponseSchema.extend({
  showOnOrgProfile: z.boolean(),
});

export const myOrganizationVisibilityUpdateRouteSchema = {
  tags: ["Me"],
  summary: "Toggle whether I appear on my organization's public page",
  request: {
    body: { content: { "application/json": { schema: myOrganizationVisibilityUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Updated.",
      content: { "application/json": { schema: myOrganizationVisibilityUpdateResponseSchema } },
    },
  },
};

export const addCoworkerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.string().email(),
});

export const addedCoworkerSchema = z.object({
  representativeId: databaseIdSchema,
  membershipId: databaseIdSchema,
  userId: databaseIdSchema,
  name: z.string(),
  email: z.string().email(),
});
export type AddedCoworker = z.infer<typeof addedCoworkerSchema>;

export const addCoworkerRouteSchema = {
  tags: ["Me"],
  summary: "Enroll a coworker as a representative of my organization (self-service)",
  description:
    "Only the organization's primary or secondary contact may call this. The new representative's category is inherited from the organization's shared membership category (member_category_assignments).",
  request: {
    body: { content: { "application/json": { schema: addCoworkerSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Coworker enrolled.",
      content: {
        "application/json": {
          schema: addedCoworkerSchema,
        },
      },
    },
    "403": { description: "Caller is not an org contact, or has no organization." },
    "409": { description: "Email already holds an active membership, or the org has no membership category set." },
  },
};

// ── Organization profile & content moderation ────────────────

export const myOrganizationReviewSchema = organizationContentReviewSchema;
export const myOrganizationLogoUploadResponseSchema = successResponseSchema.extend({ r2Key: z.string().min(1) });
export const myHeadshotUploadResponseSchema = successResponseSchema.extend({ r2Key: z.string().min(1) });

export const myOrganizationProfileSchema = z
  .object({
    id: databaseIdSchema,
    name: z.string(),
    isOrgContact: z.boolean(),
    isPrimaryContact: z.boolean(),
    pendingSecondaryContactUserId: databaseIdSchema.nullable(),
    pendingReview: myOrganizationReviewSchema.nullable(),
  })
  .extend(organizationProfileContentFieldsSchema.shape);

export const myOrganizationProfileGetRouteSchema = {
  tags: ["Me"],
  summary: "View my organization's current live profile",
  responses: {
    "200": {
      description: "My organization's profile.",
      content: { "application/json": { schema: myOrganizationProfileSchema } },
    },
    "403": { description: "Caller has no organization." },
  },
};

export const myOrganizationContentChangeSchema = organizationEditableContentSchema;
export const myOrganizationContentChangeResponseSchema = z.object({ review: myOrganizationReviewSchema });

export const myOrganizationContentChangeRouteSchema = {
  tags: ["Me"],
  summary: "Submit an organization content change for staff review",
  description:
    "Only the org's primary or secondary contact may call this. Queues the change in the moderation queue — the live profile is unchanged until a staff admin approves it. Only one pending submission per organization at a time.",
  request: {
    body: { content: { "application/json": { schema: myOrganizationContentChangeSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Submitted for review.",
      content: { "application/json": { schema: myOrganizationContentChangeResponseSchema } },
    },
    "403": { description: "Caller is not an org contact, or has no organization." },
    "409": { description: "A submission is already pending review." },
    "422": { description: "No editable fields were submitted." },
  },
};

export const myOrganizationReviewsListQuerySchema = listQuerySchema(["submittedAt", "status"] as const).extend({
  status: z.union([contentReviewStatusSchema, z.literal("history")]).default("history"),
});
export type MyOrganizationReviewsListQuery = z.infer<typeof myOrganizationReviewsListQuerySchema>;
export const myOrganizationReviewsListResponseSchema = paginatedResponseSchema("reviews", myOrganizationReviewSchema);

export const myOrganizationReviewsListRouteSchema = {
  tags: ["Me"],
  summary: "Status of my organization's pending/past content submissions",
  request: { query: myOrganizationReviewsListQuerySchema },
  responses: {
    "200": {
      description: "My organization's review history.",
      content: {
        "application/json": {
          schema: myOrganizationReviewsListResponseSchema,
        },
      },
    },
    "403": { description: "Caller has no organization." },
  },
};

export const myOrganizationReviewWithdrawRouteSchema = {
  tags: ["Me"],
  summary: "Withdraw a pending organization content submission",
  request: { params: z.object({ id: databaseIdSchema }) },
  responses: {
    "200": { description: "Withdrawn." },
    "404": { description: "Review not found." },
    "409": { description: "Only a pending review can be withdrawn." },
  },
};

export const myOrganizationLogoUploadRouteSchema = {
  tags: ["Me"],
  summary: "Propose a new organization logo",
  description:
    "multipart/form-data with a single 'file' field. Held in R2 staging and folds into the org's single pending content review until a staff admin approves it.",
  responses: {
    "200": {
      description: "Staged.",
      content: { "application/json": { schema: myOrganizationLogoUploadResponseSchema } },
    },
    "403": { description: "Caller is not an org contact, or has no organization." },
    "413": { description: "File too large." },
    "415": { description: "Unsupported file type." },
  },
};

export const mySecondaryContactNominateSchema = z.object({
  userId: databaseIdSchema.nullable(),
});
export const mySecondaryContactNominateResponseSchema = z.object({
  pendingSecondaryContactUserId: databaseIdSchema.nullable(),
});

export const mySecondaryContactNominateRouteSchema = {
  tags: ["Me"],
  summary: "Nominate a secondary contact for my organization",
  description:
    "Only the primary contact may call this. Held as a pending nomination (organization_secondary_contact_nominations) until a staff admin confirms it. Pass userId: null to withdraw a pending nomination.",
  request: {
    body: { content: { "application/json": { schema: mySecondaryContactNominateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Nomination recorded.",
      content: { "application/json": { schema: mySecondaryContactNominateResponseSchema } },
    },
    "403": { description: "Only the primary contact may nominate a secondary contact." },
    "422": {
      description: "Nominee is not an active member of the same organization, or is already the primary contact.",
    },
  },
};

export const myHeadshotUploadRouteSchema = {
  tags: ["Me"],
  summary: "Upload my headshot",
  description: "multipart/form-data with a single 'file' field. JPEG, PNG, or WebP, up to 5MB.",
  responses: {
    "200": {
      description: "Uploaded.",
      content: { "application/json": { schema: myHeadshotUploadResponseSchema } },
    },
    "413": { description: "File too large." },
    "415": { description: "Unsupported file type." },
  },
};
// ── Notification preferences (Account Settings) ─────────

export const myNotificationPreferencesSchema = z.object({
  workingGroupUpdates: z.boolean(),
  voteReminders: z.boolean(),
  generalAnnouncements: z.boolean(),
  // Weekly digest of working-group join/leave activity, sent only to
  // members currently assigned as a WG chair or vice-chair (2026-07-31
  // manual-testing feedback — see wg-chair-digest.ts). Shown to every
  // member in Account Settings regardless of chair status, matching this
  // schema's existing precedent: voteReminders is shown regardless of the
  // current D1-configured voting eligibility of the member's category.
  wgChairMembershipDigest: z.boolean(),
});

export const myNotificationPreferencesGetRouteSchema = {
  tags: ["Me"],
  summary: "Get my email notification preferences",
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
  summary: "Update my email notification preferences",
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

// ── Organization sponsorship view ────────────────────

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
