/**
 * Admin Organizations management (post-approval org profile + roster
 * management, folding the PRD §6 Interim Admin Tool's org-tied `members`
 * rows into a per-organization view). Backs `GET/PATCH /api/v1/admin/
 * organizations[/:id]`, its logo endpoint, `POST .../:id/members`
 * (add a representative to an existing org), and `PATCH/DELETE
 * /api/v1/admin/members/:id` (edit/remove a single representative).
 *
 * Reuses the membership-category vocabulary already established by
 * admin-members.ts rather than redefining it.
 */
import { z } from "zod";
import { normalizedEmailSchema } from "./api";
import { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "./admin-members";

function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

export const ORG_TIED_MEMBERSHIP_CATEGORIES = MEMBERSHIP_CATEGORIES.filter(
  (c) => !INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(c),
) as [string, ...string[]];
export const orgTiedMembershipCategorySchema = z.enum(ORG_TIED_MEMBERSHIP_CATEGORIES);

export const INDIVIDUAL_MEMBERSHIP_CATEGORIES_LIST = MEMBERSHIP_CATEGORIES.filter((c) =>
  INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(c),
) as [string, ...string[]];
export const individualMembershipCategorySchema = z.enum(INDIVIDUAL_MEMBERSHIP_CATEGORIES_LIST);

export const MEMBER_STATUSES = ["active", "inactive", "pending", "lapsed"] as const;
export const memberStatusSchema = z.enum(MEMBER_STATUSES);

export const organizationIdParamsSchema = z.object({ id: z.uuid() });
export const memberIdParamsSchema = z.object({ id: z.uuid() });

// ── Organization list/detail ────────────────────────────────────────────────

export const adminOrganizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  website: z.string().nullable(),
  description: z.string().nullable(),
  slogan: z.string().nullable(),
  logoUrl: z.string().nullable(),
  memberCount: z.number(),
  primaryContactName: z.string().nullable(),
  primaryContactEmail: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// membershipCategory is deliberately absent here — category is now an
// organization-level fact (organizations.membership_category), surfaced
// once at the top of adminOrganizationDetailSchema rather than repeated
// per representative. members.member_type still mirrors it in the DB for
// org-tied representatives, but that's a denormalized implementation
// detail, not something this API exposes per-row anymore.
export const adminOrganizationRepresentativeSchema = z.object({
  memberId: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  jobTitle: z.string().nullable(),
  status: z.string(),
  showOnOrgProfile: z.boolean(),
  isPrimaryContact: z.boolean(),
  isSecondaryContact: z.boolean(),
  createdAt: z.string(),
});

export const adminOrganizationDetailSchema = adminOrganizationSummarySchema.extend({
  membershipCategory: z.string().nullable(),
  contentMarkdown: z.string().nullable(),
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
  primaryContactUserId: z.uuid().nullable(),
  secondaryContactUserId: z.uuid().nullable(),
  representatives: z.array(adminOrganizationRepresentativeSchema),
});

export const organizationsListQuerySchema = z.object({
  q: trimmedString(1, 200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const organizationsListRouteSchema = {
  tags: ["Organizations"],
  summary: "List organizations (admin)",
  description: "Paginated, optionally name-filtered list of every organization, with roster size and primary contact.",
  request: { query: organizationsListQuerySchema },
  responses: {
    "200": {
      description: "Organizations list.",
      content: {
        "application/json": {
          schema: z.object({
            organizations: z.array(adminOrganizationSummarySchema),
            page: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }),
          }),
        },
      },
    },
  },
};

export const organizationGetRouteSchema = {
  tags: ["Organizations"],
  summary: "Get an organization's profile and roster",
  request: { params: organizationIdParamsSchema },
  responses: {
    "200": {
      description: "Organization detail.",
      content: { "application/json": { schema: z.object({ organization: adminOrganizationDetailSchema }) } },
    },
    "404": { description: "Organization not found." },
  },
};

// ── Organization profile update ─────────────────────────────────────────────

export const organizationUpdateSchema = z.object({
  name: trimmedString(1, 200).optional(),
  // Category is now an organization-level property (migration 0040). Setting
  // it here cascades to every existing org-tied representative's
  // members.member_type (see updateAdminOrganization) so the two stay in
  // sync — member_type is a mirror for org-tied members, not an
  // independent value.
  membershipCategory: orgTiedMembershipCategorySchema.optional(),
  description: trimmedString(0, 2000).nullable().optional(),
  website: z.url().nullable().optional(),
  contentMarkdown: trimmedString(0, 20000).nullable().optional(),
  slogan: trimmedString(0, 300).nullable().optional(),
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
  primaryContactUserId: z.uuid().nullable().optional(),
  secondaryContactUserId: z.uuid().nullable().optional(),
});

export const organizationUpdateRouteSchema = {
  tags: ["Organizations"],
  summary: "Update an organization's profile",
  description:
    "PRD §4.11 data-bearing fields (pulled forward by migration 0037). primaryContactUserId/secondaryContactUserId must reference an existing representative (members row) of this organization, or null.",
  request: {
    params: organizationIdParamsSchema,
    body: { content: { "application/json": { schema: organizationUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Organization updated.",
      content: { "application/json": { schema: z.object({ organization: adminOrganizationDetailSchema }) } },
    },
    "404": { description: "Organization not found." },
    "409": { description: "Another organization already uses that name." },
    "422": { description: "primaryContactUserId/secondaryContactUserId is not a representative of this organization." },
  },
};

// ── Add representative to an existing organization ─────────────────────────

// membershipCategory is deliberately not accepted here — an added
// representative always inherits organizations.membership_category (set
// once per org via PATCH /api/v1/admin/organizations/:id). If the
// organization has no category set yet, the request is rejected (422) and
// staff must set the org's category first.
export const organizationRepresentativeAddSchema = z.object({
  name: trimmedString(1, 200),
  email: normalizedEmailSchema,
  jobTitle: trimmedString(0, 200).optional(),
  linkedin: z.url().optional(),
});

export const organizationAddRepresentativeRouteSchema = {
  tags: ["Organizations"],
  summary: "Add a representative to an organization",
  description:
    "Finds-or-creates the user by email and adds an active members row linking them to this organization, inheriting the organization's membership category. If the organization has no primary (or secondary) contact yet, the new representative is assigned to the open slot.",
  request: {
    params: organizationIdParamsSchema,
    body: { content: { "application/json": { schema: organizationRepresentativeAddSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Representative added.",
      content: { "application/json": { schema: z.object({ representative: adminOrganizationRepresentativeSchema }) } },
    },
    "404": { description: "Organization not found." },
    "409": { description: "This person already holds a membership." },
  },
};

// ── Single-member edit/remove (used from both Organizations and Users UI) ──

// membershipCategory is still accepted here — but only actually honored by
// updateAdminMember for org-less (organization_id IS NULL) members; for
// org-tied members it's controlled at the organization level instead (see
// organizationUpdateSchema) and this endpoint rejects it with a 422. It's
// restricted to the individual-only category vocabulary since those are
// the only categories this endpoint can still change.
export const memberUpdateSchema = z.object({
  membershipCategory: individualMembershipCategorySchema.optional(),
  status: memberStatusSchema.optional(),
  showOnOrgProfile: z.boolean().optional(),
});

export const memberUpdateRouteSchema = {
  tags: ["Membership"],
  summary: "Update a member's category/status/visibility",
  request: {
    params: memberIdParamsSchema,
    body: { content: { "application/json": { schema: memberUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Member updated.",
      content: { "application/json": { schema: z.object({ member: z.record(z.string(), z.unknown()) }) } },
    },
    "404": { description: "Member not found." },
  },
};

// ── Logo upload/delete ──────────────────────────────────────────────────

export const adminOrganizationLogoPutRouteSchema = {
  tags: ["Organizations"],
  summary: "Upload or replace an organization's logo",
  description:
    "Stored raw (no re-encode) to preserve transparency/aspect ratio. Served via GET /api/v1/members/:id/logo.",
  request: { params: organizationIdParamsSchema },
  responses: {
    "200": {
      description: "Logo uploaded.",
      content: {
        "application/json": {
          schema: z.object({ success: z.boolean(), r2Key: z.string(), logoUrl: z.string() }),
        },
      },
    },
    "404": { description: "Organization not found." },
    "415": { description: "Unsupported image type." },
    "413": { description: "File too large." },
  },
};

export const adminOrganizationLogoDeleteRouteSchema = {
  tags: ["Organizations"],
  summary: "Remove an organization's logo",
  request: { params: organizationIdParamsSchema },
  responses: {
    "200": { description: "Logo removed." },
    "404": { description: "Organization not found." },
  },
};

export const memberDeleteRouteSchema = {
  tags: ["Membership"],
  summary: "Remove a membership (detach a representative)",
  description:
    "Deletes the members row. The underlying user account is untouched. If the removed person was an organization's primary or secondary contact, that slot is cleared.",
  request: { params: memberIdParamsSchema },
  responses: {
    "200": { description: "Membership removed." },
    "404": { description: "Member not found." },
  },
};

// ── Secondary contact nomination confirmation (§4.11) ──────────────────────

export const confirmSecondaryContactRouteSchema = {
  tags: ["Organizations"],
  summary: "Confirm a pending secondary contact nomination",
  description:
    "Confirms the nomination held in organizations.pending_secondary_contact_user_id (submitted by the primary contact via PATCH /api/v1/me/organization/secondary-contact), promoting it to secondary_contact_user_id.",
  request: { params: organizationIdParamsSchema },
  responses: {
    "200": {
      description: "Confirmed.",
      content: {
        "application/json": {
          schema: z.object({ organizationId: z.uuid(), secondaryContactUserId: z.uuid() }),
        },
      },
    },
    "404": { description: "Organization not found." },
    "409": { description: "No pending nomination." },
  },
};

// ── Organization content moderation queue (§4.11) ──────────────────────────

export const contentReviewSummarySchema = z.object({
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
  organizationName: z.string(),
  submitterName: z.string(),
  submitterEmail: z.string(),
});

export const contentReviewsListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const contentReviewsListRouteSchema = {
  tags: ["Organizations"],
  summary: "List organization content moderation submissions",
  description: "Defaults to status=pending — the moderation queue.",
  request: { query: contentReviewsListQuerySchema },
  responses: {
    "200": {
      description: "Reviews list.",
      content: {
        "application/json": {
          schema: z.object({
            reviews: z.array(contentReviewSummarySchema),
            page: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }),
          }),
        },
      },
    },
  },
};

export const contentReviewDiffEntrySchema = z.object({
  field: z.string(),
  current: z.unknown(),
  proposed: z.unknown(),
});

export const contentReviewDetailSchema = contentReviewSummarySchema.extend({
  diff: z.array(contentReviewDiffEntrySchema),
  logoStagingR2Key: z.string().nullable(),
  currentLogoR2Key: z.string().nullable(),
});

export const contentReviewIdParamsSchema = z.object({ id: z.uuid() });

export const contentReviewGetRouteSchema = {
  tags: ["Organizations"],
  summary: "Review detail with a side-by-side diff",
  request: { params: contentReviewIdParamsSchema },
  responses: {
    "200": {
      description: "Review detail.",
      content: { "application/json": { schema: z.object({ review: contentReviewDetailSchema }) } },
    },
    "404": { description: "Review not found." },
  },
};

export const contentReviewApproveRouteSchema = {
  tags: ["Organizations"],
  summary: "Approve a content submission — applies the changes live",
  request: { params: contentReviewIdParamsSchema },
  responses: {
    "200": { description: "Approved." },
    "404": { description: "Review not found." },
    "409": { description: "Only a pending review can be approved." },
  },
};

export const contentReviewRejectSchema = z.object({
  reviewerNote: trimmedString(1, 2000),
});

export const contentReviewRejectRouteSchema = {
  tags: ["Organizations"],
  summary: "Reject a content submission",
  request: {
    params: contentReviewIdParamsSchema,
    body: { content: { "application/json": { schema: contentReviewRejectSchema } }, required: true },
  },
  responses: {
    "200": { description: "Rejected." },
    "404": { description: "Review not found." },
    "409": { description: "Only a pending review can be rejected." },
  },
};

// ── Grant an individual (org-less, H5/H6/H7) membership to an existing user ─

export const userIdParamsSchema = z.object({ userId: z.uuid() });

export const individualMembershipGrantSchema = z.object({
  membershipCategory: individualMembershipCategorySchema,
});

export const userMembershipGrantRouteSchema = {
  tags: ["Membership"],
  summary: "Grant an individual (H5/H6/H7) membership to an existing user",
  description:
    "For org-tied categories, add the user as a representative of an organization via POST /api/v1/admin/organizations/:id/members instead.",
  request: {
    params: userIdParamsSchema,
    body: { content: { "application/json": { schema: individualMembershipGrantSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Membership granted.",
      content: { "application/json": { schema: z.object({ member: z.record(z.string(), z.unknown()) }) } },
    },
    "404": { description: "User not found." },
    "409": { description: "This user already holds a membership." },
  },
};
