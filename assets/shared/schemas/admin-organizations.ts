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

export const adminOrganizationRepresentativeSchema = z.object({
  memberId: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  jobTitle: z.string().nullable(),
  membershipCategory: z.string(),
  status: z.string(),
  showOnOrgProfile: z.boolean(),
  isPrimaryContact: z.boolean(),
  isSecondaryContact: z.boolean(),
  createdAt: z.string(),
});

export const adminOrganizationDetailSchema = adminOrganizationSummarySchema.extend({
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

export const organizationRepresentativeAddSchema = z.object({
  name: trimmedString(1, 200),
  email: normalizedEmailSchema,
  jobTitle: trimmedString(0, 200).optional(),
  linkedin: z.url().optional(),
  membershipCategory: orgTiedMembershipCategorySchema,
});

export const organizationAddRepresentativeRouteSchema = {
  tags: ["Organizations"],
  summary: "Add a representative to an organization",
  description:
    "Finds-or-creates the user by email and adds an active members row linking them to this organization. If the organization has no primary (or secondary) contact yet, the new representative is assigned to the open slot.",
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

export const memberUpdateSchema = z.object({
  membershipCategory: z.string().trim().min(1).max(10).optional(),
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
