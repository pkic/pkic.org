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
    activeIdentityCount: z.number(),
    primaryContactName: z.string().nullable(),
    primaryContactEmail: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .extend(organizationProfileSummaryFieldsSchema.shape);

// membershipCategory is deliberately absent here — category lives once per
// aggregate (member_category_assignments, consolidated migration 0035), surfaced once at
// the top-level organization detail rather than repeated per identity.
// `identityId` is this exact acting capacity's identities.id. `membershipId`
// is the shared members.id aggregate every identity for the organization has
// in common; it is never the id used to update an identity.
export const organizationIdentityManagementSchema = z.object({
  identityId: databaseIdSchema,
  membershipId: databaseIdSchema.nullable(),
  userId: databaseIdSchema,
  name: z.string(),
  emailId: databaseIdSchema.nullable(),
  email: z.string(),
  headshotUrl: httpOrSameOriginUrlSchema.nullable(),
  jobTitle: z.string().nullable(),
  biography: z.string().nullable(),
  links: linksSchema,
  state: z.literal("active"),
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
    identities: z.array(organizationIdentityManagementSchema),
  });
export const organizationDetailResponseSchema = z.object({ organization: organizationDetailSchema });

export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;
export type OrganizationDetail = z.infer<typeof organizationDetailSchema>;

/** Allowlisted sort columns for GET /api/v1/organizations — see listOrganizations. */
export const ORGANIZATIONS_SORT_COLUMNS = ["name", "membership_category", "created_at", "identity_count"] as const;

export const organizationsListQuerySchema = listQuerySchema(ORGANIZATIONS_SORT_COLUMNS);
export type OrganizationsListQuery = z.infer<typeof organizationsListQuerySchema>;
export const organizationsListResponseSchema = paginatedResponseSchema("organizations", organizationSummarySchema);

// ── Organization profile update ─────────────────────────────────────────────

export const organizationEditableUpdateSchema = organizationEditableContentSchema.extend({
  name: trimmedString(1, 200).optional(),
  // Category is now an organization-level property (consolidated migration 0035). Setting
  // it here updates the organization's one Member aggregate; identities
  // derive the category through identity_member_capacities.
  membershipCategory: orgTiedMembershipCategorySchema.optional(),
  memberSince: z.iso.date().nullable().optional(),
  primaryContactUserId: databaseIdSchema.nullable().optional(),
  secondaryContactUserId: databaseIdSchema.nullable().optional(),
});

// ── Add an identity to an existing organization ────────────────────────────

// ── Canonical domain routes ────────────────────────────────────────────────

/** Domain-route parameter name. */
export const organizationManagementParamsSchema = z.object({ organizationId: databaseIdSchema });

export const organizationIdentityProvisionSchema = z.object({
  name: trimmedString(1, 200),
  email: normalizedEmailSchema,
  jobTitle: trimmedString(0, 200).optional(),
  biography: trimmedString(0, 5000).optional(),
  links: linksSchema.optional(),
});

/**
 * New organizations always have an organization-tied membership aggregate.
 * Initial identities are optional: staff may create the organization alone
 * and invite people through the roster later. When identities ARE provided
 * they start active immediately — skipping the invitation flow — so that
 * path, and only that path, must carry an activation reason for the audit
 * log (and demands the `identities:activate` permission on the server).
 */
export const organizationCreateSchema = z
  .object({
    name: trimmedString(1, 200),
    website: httpUrlSchema.optional(),
    description: trimmedString(0, 2000).optional(),
    links: linksSchema.optional(),
    membershipCategory: orgTiedMembershipCategorySchema,
    memberSince: z.iso.date(),
    identities: z.array(organizationIdentityProvisionSchema).max(10).default([]),
    workingGroupSlugs: z.array(groupSlugSchema).max(200).default([]),
    activationReason: trimmedString(1, 500).optional(),
  })
  .refine((input) => input.identities.length === 0 || input.activationReason !== undefined, {
    message: "Explain why these people are being activated without an invitation.",
    path: ["activationReason"],
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
  summary: "Create an organization, optionally with initial acting identities",
  description:
    "Identities are optional. When any are provided they are activated immediately, which additionally requires the identities:activate permission and an activationReason recorded in the audit log.",
  request: { body: { required: true, content: { "application/json": { schema: organizationCreateSchema } } } },
  responses: {
    "201": {
      description: "Organization created.",
      content: { "application/json": { schema: organizationCreateResponseSchema } },
    },
    "403": {
      description: "membership:write permission required; identities:activate as well when identities are provided.",
    },
    "409": { description: "An organization or active identity already exists." },
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
    "422": { description: "An organization contact must hold an active identity." },
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
