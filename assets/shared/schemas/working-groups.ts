/**
 * Temporary wire compatibility for legacy /working-groups callers.
 * New code must use groups.ts and route-contracts-groups.ts. Delete this
 * module when the last legacy route and frontend caller has migrated.
 */
import { z } from "zod";
import { slugPattern, trimmedString } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export const workingGroupIdSchema = databaseIdSchema;
export const workingGroupSlugSchema = z.string().trim().min(1).max(200).regex(slugPattern);
export const workingGroupReferenceSchema = z.union([workingGroupIdSchema, workingGroupSlugSchema]);
export const workingGroupLabelSchema = z.object({ slug: workingGroupSlugSchema, name: trimmedString(1, 200) });
export type WorkingGroupLabel = z.infer<typeof workingGroupLabelSchema>;
export const workingGroupIdParamsSchema = z.object({ id: workingGroupReferenceSchema });
export const workingGroupMemberParamsSchema = z.object({
  id: workingGroupReferenceSchema,
  userId: databaseIdSchema,
});

export const workingGroupCreateSchema = z.object({
  name: trimmedString(1, 200),
  description: trimmedString(0, 2000).nullable().optional(),
  mailingListEmail: z.email().nullable().optional(),
  minEndorsersForBallot: z.number().int().min(0).max(1000).optional(),
});
export type WorkingGroupCreateInput = z.infer<typeof workingGroupCreateSchema>;
export const workingGroupUpdateSchema = z.object({
  name: trimmedString(1, 200).optional(),
  description: trimmedString(0, 2000).nullable().optional(),
  mailingListEmail: z.email().nullable().optional(),
  minEndorsersForBallot: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});
export type WorkingGroupUpdateInput = z.infer<typeof workingGroupUpdateSchema>;
export const workingGroupMemberAddSchema = z.object({ userId: databaseIdSchema });

export const chairInfoSchema = z.object({
  userRoleId: databaseIdSchema,
  userId: databaseIdSchema,
  name: z.string(),
  email: z.string(),
  expiresAt: z.string().nullable(),
});
export const adminWorkingGroupSummarySchema = z.object({
  id: workingGroupIdSchema,
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  mailingListEmail: z.string().nullable(),
  minEndorsersForBallot: z.number(),
  active: z.boolean(),
  chair: chairInfoSchema.nullable(),
  viceChair: chairInfoSchema.nullable(),
  memberCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const adminWorkingGroupMemberSchema = z.object({
  userId: databaseIdSchema,
  name: z.string(),
  email: z.string(),
  organizationName: z.string().nullable(),
  memberCategory: z.string().nullable(),
  joinedAt: z.string(),
});
export const adminWorkingGroupDetailSchema = adminWorkingGroupSummarySchema.extend({});
export const workingGroupResponseSchema = z.object({ workingGroup: adminWorkingGroupSummarySchema });
export type AdminWorkingGroupSummary = z.infer<typeof adminWorkingGroupSummarySchema>;
export type AdminWorkingGroupMember = z.infer<typeof adminWorkingGroupMemberSchema>;
export type AdminWorkingGroupDetail = z.infer<typeof adminWorkingGroupDetailSchema>;

export const ADMIN_WORKING_GROUP_SORT_COLUMNS = ["name", "slug", "member_count", "active", "created_at"] as const;
export const workingGroupsListQuerySchema = listQuerySchema(ADMIN_WORKING_GROUP_SORT_COLUMNS).extend({
  active: z.enum(["true", "false"]).optional(),
});
export type WorkingGroupsListQuery = z.infer<typeof workingGroupsListQuerySchema>;
export const workingGroupsListResponseSchema = paginatedResponseSchema("workingGroups", adminWorkingGroupSummarySchema);
export const ADMIN_WORKING_GROUP_MEMBER_SORT_COLUMNS = [
  "name",
  "email",
  "organization_name",
  "member_category",
  "joined_at",
] as const;
export const workingGroupMembersListQuerySchema = listQuerySchema(ADMIN_WORKING_GROUP_MEMBER_SORT_COLUMNS);
export type WorkingGroupMembersListQuery = z.infer<typeof workingGroupMembersListQuerySchema>;
export const workingGroupMembersListResponseSchema = paginatedResponseSchema("members", adminWorkingGroupMemberSchema);

export const workingGroupsListRouteSchema = {
  tags: ["Working Groups (legacy)"],
  summary: "List all working groups (legacy)",
  request: { query: workingGroupsListQuerySchema },
  responses: {
    "200": {
      description: "All working groups.",
      content: { "application/json": { schema: workingGroupsListResponseSchema } },
    },
  },
};
export const workingGroupGetRouteSchema = {
  tags: ["Working Groups (legacy)"],
  summary: "Get a working group (legacy)",
  request: { params: workingGroupIdParamsSchema },
  responses: {
    "200": {
      description: "Working group detail.",
      content: { "application/json": { schema: workingGroupResponseSchema } },
    },
    "404": { description: "Working group not found." },
  },
};
export const workingGroupCreateRouteSchema = {
  tags: ["Working Groups (legacy)"],
  summary: "Create a working group (legacy)",
  request: { body: { content: { "application/json": { schema: workingGroupCreateSchema } }, required: true } },
  responses: {
    "201": { description: "Created.", content: { "application/json": { schema: workingGroupResponseSchema } } },
  },
};
export const workingGroupUpdateRouteSchema = {
  tags: ["Working Groups (legacy)"],
  summary: "Update a working group (legacy)",
  request: {
    params: workingGroupIdParamsSchema,
    body: { content: { "application/json": { schema: workingGroupUpdateSchema } }, required: true },
  },
  responses: {
    "200": { description: "Updated.", content: { "application/json": { schema: workingGroupResponseSchema } } },
  },
};
export const workingGroupMemberAddRouteSchema = {
  tags: ["Working Groups (legacy)"],
  summary: "Add a member (legacy)",
  request: {
    params: workingGroupIdParamsSchema,
    body: { content: { "application/json": { schema: workingGroupMemberAddSchema } }, required: true },
  },
  responses: { "201": { description: "Added." } },
};
export const workingGroupMembersListRouteSchema = {
  tags: ["Working Groups (legacy)"],
  summary: "List members (legacy)",
  request: { params: workingGroupIdParamsSchema, query: workingGroupMembersListQuerySchema },
  responses: {
    "200": {
      description: "Members.",
      content: { "application/json": { schema: workingGroupMembersListResponseSchema } },
    },
  },
};
export const workingGroupMemberRemoveRouteSchema = {
  tags: ["Working Groups (legacy)"],
  summary: "Remove a member (legacy)",
  request: { params: workingGroupMemberParamsSchema },
  responses: { "200": { description: "Removed." } },
};
