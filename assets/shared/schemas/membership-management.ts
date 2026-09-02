/**
 * Staff membership capacity contracts. `POST /api/v1/members` provisions a
 * member aggregate, while `GET /api/v1/members/capacities` lists the
 * staff-managed individual and organization identity capacities. Both use the same organization/identity shape
 * as the YAML importer.
 */
import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { normalizedEmailSchema, trimmedString } from "./api-common";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import { linksSchema } from "./links";
import { groupSlugSchema } from "./groups";
import {
  MEMBERSHIP_CATEGORIES,
  membershipCategorySchema,
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  memberStatusSchema,
} from "./membership-categories";
import { httpUrlSchema } from "./urls";

export { MEMBERSHIP_CATEGORIES, membershipCategorySchema, INDIVIDUAL_MEMBERSHIP_CATEGORIES };

export const INDIVIDUAL_MEMBERSHIP_CATEGORIES_LIST = MEMBERSHIP_CATEGORIES.filter((category) =>
  INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(category),
) as [string, ...string[]];
export const individualMembershipCategorySchema = z.enum(INDIVIDUAL_MEMBERSHIP_CATEGORIES_LIST);

export const memberProvisionIdentitySchema = z.object({
  name: trimmedString(1, 200),
  email: normalizedEmailSchema,
  role: trimmedString(0, 200).optional(),
  links: linksSchema.optional(),
});

export const memberProvisionSchema = z
  .object({
    organizationName: trimmedString(1, 200).optional(),
    website: httpUrlSchema.optional(),
    description: trimmedString(0, 2000).optional(),
    membershipCategory: membershipCategorySchema,
    memberSince: z.iso.date(),
    identities: z.array(memberProvisionIdentitySchema).min(1).max(10),
    workingGroupSlugs: z.array(groupSlugSchema).max(200).default([]),
    activationReason: trimmedString(1, 500),
  })
  .superRefine((value, ctx) => {
    const isIndividual = INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(value.membershipCategory);

    if (isIndividual) {
      if (value.organizationName) {
        ctx.addIssue({
          code: "custom",
          message: "Individual categories (H5/H6/H7) have no organization — leave organizationName blank",
          path: ["organizationName"],
        });
      }
      if (value.identities.length !== 1) {
        ctx.addIssue({
          code: "custom",
          message: "Individual categories (H5/H6/H7) must have exactly one identity",
          path: ["identities"],
        });
      }
    } else if (!value.organizationName) {
      ctx.addIssue({
        code: "custom",
        message: "organizationName is required for org-tied categories (A-G, H1-H4, H8)",
        path: ["organizationName"],
      });
    }
  });

const memberCapacityCoreSchema = z.object({
  id: databaseIdSchema,
  userId: databaseIdSchema,
  organizationId: databaseIdSchema.nullable(),
  membershipCategory: membershipCategorySchema,
  status: memberStatusSchema,
  showOnOrgProfile: z.boolean(),
});

export const memberCapacitySummarySchema = memberCapacityCoreSchema.extend({
  organizationName: z.string().nullable(),
  name: z.string(),
  email: z.string(),
  createdAt: z.string(),
});

export type MemberCapacitySummary = z.infer<typeof memberCapacitySummarySchema>;

export const memberProvisionResponseSchema = z.object({
  organizationId: databaseIdSchema.nullable(),
  members: z.array(memberCapacitySummarySchema),
});
export const memberCapacityMutationResponseSchema = z.object({
  member: memberCapacityCoreSchema.extend({
    createdAt: z.string().optional(),
  }),
});

export const memberCapacityIdParamsSchema = z.object({ id: databaseIdSchema });
export const memberCapacityUpdateSchema = z
  .object({
    membershipCategory: individualMembershipCategorySchema.optional(),
    status: memberStatusSchema.optional(),
    showOnOrgProfile: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "At least one field must be provided",
  });
export type MemberCapacityUpdateInput = z.infer<typeof memberCapacityUpdateSchema>;

export const individualMembershipGrantSchema = z.object({
  userId: databaseIdSchema,
  membershipCategory: individualMembershipCategorySchema,
  activationReason: trimmedString(1, 500, "Document why this identity is being activated immediately."),
});

export const MEMBER_CAPACITY_SORT_COLUMNS = [
  "name",
  "email",
  "organizationName",
  "membershipCategory",
  "status",
  "createdAt",
] as const;

export const memberCapacityListQuerySchema = listQuerySchema(MEMBER_CAPACITY_SORT_COLUMNS).extend({
  membershipCategory: membershipCategorySchema.optional(),
  status: memberStatusSchema.optional(),
});
export type MemberCapacityListQuery = z.infer<typeof memberCapacityListQuerySchema>;
export const memberCapacityListResponseSchema = paginatedResponseSchema("members", memberCapacitySummarySchema);

export const memberCapacityListRouteSchema = {
  tags: ["Membership"],
  summary: "List membership capacities",
  description:
    "Searchable, sortable, filterable staff listing of every membership capacity, one row per organizational identity or individual Member.",
  "x-pkic-auth": { required: true, scopes: ["membership:read"] },
  request: {
    query: memberCapacityListQuerySchema,
  },
  responses: {
    "200": {
      description: "Members list.",
      content: {
        "application/json": { schema: memberCapacityListResponseSchema },
      },
    },
    "400": { description: "Invalid list query." },
    "401": { description: "Staff authorization required." },
    "403": { description: "Membership read permission required." },
  },
};

export const memberProvisionRouteSchema = {
  tags: ["Membership"],
  summary: "Provision a member",
  description:
    "Creates active organizations, users, memberships, and selected group memberships immediately. No email is sent.",
  "x-pkic-auth": { required: true, scopes: ["membership:write", "identities:activate"] },
  request: {
    body: { content: { "application/json": { schema: memberProvisionSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Member(s) created.",
      content: { "application/json": { schema: memberProvisionResponseSchema } },
    },
    "400": { description: "Invalid membership provision request." },
    "401": { description: "Staff authorization required." },
    "403": { description: "Membership write permission required." },
    "409": { description: "A listed identity already holds a membership." },
  },
};

export const memberCapacityUpdateRouteSchema = {
  tags: ["Membership"],
  summary: "Update a membership capacity",
  "x-pkic-auth": { required: true, scopes: ["membership:write", "identities:activate"] },
  request: {
    params: memberCapacityIdParamsSchema,
    body: { content: { "application/json": { schema: memberCapacityUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Membership capacity updated.",
      content: { "application/json": { schema: memberCapacityMutationResponseSchema } },
    },
    "400": { description: "Invalid member identifier or update body." },
    "401": { description: "Staff authorization required." },
    "403": { description: "Membership write permission required." },
    "404": { description: "Membership capacity not found." },
    "409": { description: "Membership authorization changed while the update was being saved." },
    "422": { description: "The requested field cannot be changed for this capacity." },
  },
};

export const memberCapacityDeleteRouteSchema = {
  tags: ["Membership"],
  summary: "Remove a membership capacity",
  description:
    "Ends an individual membership or an organization identity. The user account and organization aggregate remain intact.",
  "x-pkic-auth": { required: true, scopes: ["membership:write"] },
  request: { params: memberCapacityIdParamsSchema },
  responses: {
    "200": { description: "Membership capacity removed." },
    "400": { description: "Invalid member identifier." },
    "401": { description: "Staff authorization required." },
    "403": { description: "Membership write permission required." },
    "404": { description: "Membership capacity not found." },
    "409": { description: "Membership authorization changed while the update was being saved." },
  },
};

export const individualMembershipGrantRouteSchema = {
  tags: ["Membership"],
  summary: "Grant an individual membership to an existing user",
  description:
    "For organization-tied categories, invite the user through the canonical organization identity route instead.",
  "x-pkic-auth": { required: true, scopes: ["membership:write"] },
  request: {
    body: { content: { "application/json": { schema: individualMembershipGrantSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Individual membership granted.",
      content: { "application/json": { schema: memberCapacityMutationResponseSchema } },
    },
    "400": { description: "Invalid user identifier or membership category." },
    "401": { description: "Staff authorization required." },
    "403": { description: "Membership write permission required." },
    "404": { description: "User not found." },
    "409": { description: "The user already holds an incompatible membership capacity." },
  },
};
