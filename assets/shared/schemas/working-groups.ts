/**
 * Admin working-groups CRUD + membership management. Backs
 * `GET/POST /api/v1/admin/working-groups`, `PATCH .../:id`, and
 * `POST/DELETE .../:id/members[/:userId]` — the admin-side complement to
 * the public `GET /api/v1/working-groups[/:id]` (members-directory.ts) and
 * the member self-service `POST/DELETE /api/v1/me/working-groups/:wgId`.
 */
import { z } from "zod";
import { slugPattern } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

export const workingGroupIdSchema = databaseIdSchema;
export const workingGroupSlugSchema = z.string().trim().min(1).max(200).regex(slugPattern);
// Route references accept either a generated row id or a bounded public slug;
// the service resolves the value against both columns.
export const workingGroupReferenceSchema = z.union([workingGroupIdSchema, workingGroupSlugSchema]);
export const workingGroupIdParamsSchema = z.object({ id: workingGroupReferenceSchema });
export const workingGroupMemberParamsSchema = z.object({ id: workingGroupReferenceSchema, userId: databaseIdSchema });

export const workingGroupCreateSchema = z.object({
  name: trimmedString(1, 200),
  description: trimmedString(0, 2000).nullable().optional(),
  mailingListEmail: z.email().nullable().optional(),
  minEndorsersForBallot: z.number().int().min(0).max(1000).optional(),
});

export const workingGroupUpdateSchema = z.object({
  name: trimmedString(1, 200).optional(),
  description: trimmedString(0, 2000).nullable().optional(),
  mailingListEmail: z.email().nullable().optional(),
  minEndorsersForBallot: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
});

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

export type AdminWorkingGroupSummary = z.infer<typeof adminWorkingGroupSummarySchema>;
export type AdminWorkingGroupMember = z.infer<typeof adminWorkingGroupMemberSchema>;
export type AdminWorkingGroupDetail = z.infer<typeof adminWorkingGroupDetailSchema>;

export const ADMIN_WORKING_GROUP_SORT_COLUMNS = ["name", "slug", "member_count", "active", "created_at"] as const;
export const workingGroupsListQuerySchema = listQuerySchema(ADMIN_WORKING_GROUP_SORT_COLUMNS);
export const workingGroupsListResponseSchema = paginatedResponseSchema("workingGroups", adminWorkingGroupSummarySchema);

export const ADMIN_WORKING_GROUP_MEMBER_SORT_COLUMNS = [
  "name",
  "email",
  "organization_name",
  "member_category",
  "joined_at",
] as const;
export const workingGroupMembersListQuerySchema = listQuerySchema(ADMIN_WORKING_GROUP_MEMBER_SORT_COLUMNS);
export const workingGroupMembersListResponseSchema = paginatedResponseSchema("members", adminWorkingGroupMemberSchema);

export const workingGroupsListRouteSchema = {
  tags: ["Working Groups"],
  summary: "List all working groups (admin)",
  description: "Unlike the public GET /api/v1/working-groups, includes inactive working groups.",
  request: { query: workingGroupsListQuerySchema },
  responses: {
    "200": {
      description: "All working groups.",
      content: { "application/json": { schema: workingGroupsListResponseSchema } },
    },
  },
};

export const workingGroupGetRouteSchema = {
  tags: ["Working Groups"],
  summary: "Get a working group with its member roster (admin)",
  request: { params: workingGroupIdParamsSchema },
  responses: {
    "200": {
      description: "Working group detail.",
      content: { "application/json": { schema: z.object({ workingGroup: adminWorkingGroupDetailSchema }) } },
    },
    "404": { description: "Working group not found." },
  },
};

export const workingGroupCreateRouteSchema = {
  tags: ["Working Groups"],
  summary: "Create a working group",
  request: {
    body: { content: { "application/json": { schema: workingGroupCreateSchema } }, required: true },
  },
  responses: {
    "201": {
      description: "Working group created.",
      content: { "application/json": { schema: z.object({ workingGroup: adminWorkingGroupSummarySchema }) } },
    },
    "409": { description: "A working group with this name already exists." },
  },
};

export const workingGroupUpdateRouteSchema = {
  tags: ["Working Groups"],
  summary: "Update a working group (including deactivating it)",
  request: {
    params: workingGroupIdParamsSchema,
    body: { content: { "application/json": { schema: workingGroupUpdateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Working group updated.",
      content: { "application/json": { schema: z.object({ workingGroup: adminWorkingGroupSummarySchema }) } },
    },
    "404": { description: "Working group not found." },
  },
};

export const workingGroupMemberAddRouteSchema = {
  tags: ["Working Groups"],
  summary: "Add a member to a working group",
  description: "Enforces the same CA-category-only constraint as the member self-service join endpoint.",
  request: {
    params: workingGroupIdParamsSchema,
    body: { content: { "application/json": { schema: workingGroupMemberAddSchema } }, required: true },
  },
  responses: {
    "201": { description: "Member added." },
    "403": { description: "Target user's membership category may not join this working group (CA constraint)." },
    "404": { description: "Working group not found." },
  },
};

export const workingGroupMembersListRouteSchema = {
  tags: ["Working Groups"],
  summary: "List a working group's member roster",
  request: { params: workingGroupIdParamsSchema, query: workingGroupMembersListQuerySchema },
  responses: {
    "200": {
      description: "Paginated member roster.",
      content: { "application/json": { schema: workingGroupMembersListResponseSchema } },
    },
    "404": { description: "Working group not found." },
  },
};

export const workingGroupMemberRemoveRouteSchema = {
  tags: ["Working Groups"],
  summary: "Remove a member from a working group",
  request: { params: workingGroupMemberParamsSchema },
  responses: {
    "200": { description: "Member removed." },
    "404": { description: "Working group not found." },
  },
};
