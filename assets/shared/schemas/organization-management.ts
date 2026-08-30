/** Canonical staff organization-management transport contracts. */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { normalizedEmailSchema, successResponseSchema, trimmedString } from "./api-common";
import { linksSchema } from "./links";
import { groupSlugSchema } from "./groups";
import { logoUploadResponseSchema } from "./images";
import {
  organizationEditableContentSchema,
  organizationProfileExtendedFieldsSchema,
  organizationProfileSummaryFieldsSchema,
} from "./organization-profile";
import { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "./membership-management";
import { MEMBER_STATUSES, memberStatusSchema } from "./membership-categories";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";

export { MEMBER_STATUSES, memberStatusSchema };

export const ORG_TIED_MEMBERSHIP_CATEGORIES = MEMBERSHIP_CATEGORIES.filter(
  (c) => !INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(c),
) as [string, ...string[]];
export const orgTiedMembershipCategorySchema = z.enum(ORG_TIED_MEMBERSHIP_CATEGORIES);

export { individualMembershipCategorySchema } from "./membership-management";

// ── Organization list/detail ────────────────────────────────────────────────

export const organizationSummarySchema = z
  .object({
    id: databaseIdSchema,
    name: z.string(),
    membershipCategory: z.string().nullable(),
    memberSince: z.string(),
    memberCount: z.number(),
    primaryContactName: z.string().nullable(),
    primaryContactEmail: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .extend(organizationProfileSummaryFieldsSchema.shape);

// membershipCategory is deliberately absent here — category lives once per
// aggregate (member_category_assignments, consolidated migration 0035), surfaced once at
// the top-level organization detail rather than repeated per
// representative.
//
// Two distinct identities, both explicit rather than one polymorphic
// `memberId` (PR #1 review): `representativeId` is this person's own
// organization_representatives.id — the id PATCH/DELETE
// the canonical representative route updates/removes *this* representative.
// `membershipId` is the shared members.id aggregate every representative of
// this organization has in common — never representative-specific, and
// never the id to pass to edit/remove a single representative.
export const organizationRepresentativeManagementSchema = z.object({
  representativeId: databaseIdSchema,
  membershipId: databaseIdSchema.nullable(),
  userId: databaseIdSchema,
  name: z.string(),
  emailId: databaseIdSchema.nullable(),
  email: z.string(),
  headshotUrl: httpOrSameOriginUrlSchema.nullable(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: linksSchema,
  status: memberStatusSchema,
  showOnOrgProfile: z.boolean(),
  isPrimaryContact: z.boolean(),
  isSecondaryContact: z.boolean(),
  createdAt: z.string(),
});

export const organizationDetailSchema = organizationSummarySchema
  .extend(organizationProfileExtendedFieldsSchema.shape)
  .extend({
    primaryContactUserId: databaseIdSchema.nullable(),
    secondaryContactUserId: databaseIdSchema.nullable(),
    representatives: z.array(organizationRepresentativeManagementSchema),
  });
export const organizationDetailResponseSchema = z.object({ organization: organizationDetailSchema });

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;

/** Allowlisted sort columns for GET /api/v1/organizations — see listOrganizations. */
export const ORGANIZATIONS_SORT_COLUMNS = ["name", "membership_category", "created_at", "member_count"] as const;

export const organizationsListQuerySchema = listQuerySchema(ORGANIZATIONS_SORT_COLUMNS);
export type OrganizationsListQuery = z.infer<typeof organizationsListQuerySchema>;
export const organizationsListResponseSchema = paginatedResponseSchema("organizations", organizationSummarySchema);

// ── Organization profile update ─────────────────────────────────────────────

export const organizationEditableUpdateSchema = organizationEditableContentSchema.extend({
  name: trimmedString(1, 200).optional(),
  // Category is now an organization-level property (consolidated migration 0035). Setting
  // it here cascades to every existing org-tied representative's
  // members.member_type (see updateOrganization) so the two stay in
  // sync — member_type is a mirror for org-tied members, not an
  // independent value.
  membershipCategory: orgTiedMembershipCategorySchema.optional(),
  memberSince: z.iso.date().nullable().optional(),
  primaryContactUserId: databaseIdSchema.nullable().optional(),
  secondaryContactUserId: databaseIdSchema.nullable().optional(),
});

// ── Add representative to an existing organization ─────────────────────────

// ── Canonical domain routes ────────────────────────────────────────────────

/** Domain-route parameter name. */
export const organizationManagementParamsSchema = z.object({ organizationId: databaseIdSchema });

export const organizationRepresentativeCreateSchema = z.object({
  name: trimmedString(1, 200),
  email: normalizedEmailSchema,
  jobTitle: trimmedString(0, 200).optional(),
  biography: trimmedString(0, 5000).optional(),
  links: linksSchema.optional(),
});

/** New organizations always have an organization-tied membership aggregate. */
export const organizationCreateSchema = z.object({
  name: trimmedString(1, 200),
  website: httpUrlSchema.optional(),
  description: trimmedString(0, 2000).optional(),
  membershipCategory: orgTiedMembershipCategorySchema,
  memberSince: z.iso.date(),
  representatives: z.array(organizationRepresentativeCreateSchema).min(1).max(10),
  workingGroupSlugs: z.array(groupSlugSchema).max(200).default([]),
});

export const organizationCreateResponseSchema = organizationDetailResponseSchema;

export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;
/** `updatedAt` from a prior GET; required to prevent lost organization edits. */
export const organizationManagementUpdateSchema = organizationEditableUpdateSchema.extend({
  revision: z.string().min(1).max(64),
});
export type OrganizationManagementUpdateInput = z.infer<typeof organizationManagementUpdateSchema>;

export const organizationManagementListRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true, scopes: ["organizations:read"] },
  summary: "List organizations",
  description: "Filtering, search, sorting, counting, and pagination execute in D1.",
  request: { query: organizationsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded organization page.",
      content: { "application/json": { schema: organizationsListResponseSchema } },
    },
    "401": { description: "Staff session required." },
    "403": { description: "organizations:read permission required." },
  },
};

export const organizationCreateRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true, scopes: ["membership:write"] },
  summary: "Create an organization and its initial representatives",
  request: { body: { required: true, content: { "application/json": { schema: organizationCreateSchema } } } },
  responses: {
    "201": {
      description: "Organization created.",
      content: { "application/json": { schema: organizationCreateResponseSchema } },
    },
    "403": { description: "membership:write permission required." },
    "409": { description: "An organization or representative already exists." },
  },
};

export const organizationManagementGetRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true, scopes: ["organizations:read"] },
  summary: "Get an organization profile and roster",
  request: { params: organizationManagementParamsSchema },
  responses: {
    "200": {
      description: "Organization detail.",
      content: { "application/json": { schema: organizationDetailResponseSchema } },
    },
    "403": { description: "organizations:read permission required." },
    "404": { description: "Organization not found." },
  },
};

export const organizationManagementUpdateRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true, scopes: ["organizations:write"] },
  summary: "Update an organization profile",
  request: {
    params: organizationManagementParamsSchema,
    body: { required: true, content: { "application/json": { schema: organizationManagementUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Organization updated.",
      content: { "application/json": { schema: organizationDetailResponseSchema } },
    },
    "403": { description: "organizations:write permission required." },
    "404": { description: "Organization not found." },
    "409": { description: "Another organization already uses that name or authorization changed." },
    "422": { description: "An organization contact must be an active representative." },
  },
};

export const organizationManagementLogoPutRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true, scopes: ["organizations:write"] },
  summary: "Upload or replace an organization logo",
  request: { params: organizationManagementParamsSchema },
  responses: {
    "200": { description: "Logo uploaded.", content: { "application/json": { schema: logoUploadResponseSchema } } },
    "403": { description: "organizations:write permission required." },
    "404": { description: "Organization not found." },
  },
};

export const organizationManagementLogoDeleteRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true, scopes: ["organizations:write"] },
  summary: "Remove an organization logo",
  request: { params: organizationManagementParamsSchema },
  responses: {
    "200": { description: "Logo removed.", content: { "application/json": { schema: successResponseSchema } } },
    "403": { description: "organizations:write permission required." },
    "404": { description: "Organization not found." },
  },
};

export const organizationSecondaryContactConfirmationRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true, scopes: ["organizations:write"] },
  summary: "Confirm a pending organization secondary-contact nomination",
  request: { params: organizationManagementParamsSchema },
  responses: {
    "200": {
      description: "Secondary contact confirmed.",
      content: {
        "application/json": {
          schema: z.object({ organizationId: databaseIdSchema, secondaryContactUserId: databaseIdSchema }),
        },
      },
    },
    "403": { description: "organizations:write permission required." },
    "404": { description: "Organization not found." },
    "409": { description: "No pending nomination exists." },
  },
};
