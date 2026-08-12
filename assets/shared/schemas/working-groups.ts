/**
 * Admin working-groups CRUD + membership management. Backs
 * `GET/POST /api/v1/admin/working-groups`, `PATCH .../:id`, and
 * `POST/DELETE .../:id/members[/:userId]` — the admin-side complement to
 * the public `GET /api/v1/working-groups[/:id]` (members-directory.ts) and
 * the member self-service `POST/DELETE /api/v1/me/working-groups/:wgId`.
 */
import { z } from "zod";

function trimmedString(min: number, max: number): z.ZodString {
  return z.string().trim().min(min).max(max);
}

export const workingGroupIdParamsSchema = z.object({ id: z.string().trim().min(1) });
export const workingGroupMemberParamsSchema = z.object({ id: z.string().trim().min(1), userId: z.uuid() });

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

export const workingGroupMemberAddSchema = z.object({ userId: z.uuid() });

export const chairInfoSchema = z.object({
  userRoleId: z.uuid(),
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  expiresAt: z.string().nullable(),
});

export const adminWorkingGroupSummarySchema = z.object({
  id: z.uuid(),
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
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  organizationName: z.string().nullable(),
  memberCategory: z.string().nullable(),
  joinedAt: z.string(),
});

export const adminWorkingGroupDetailSchema = adminWorkingGroupSummarySchema.extend({
  members: z.array(adminWorkingGroupMemberSchema),
});

export const workingGroupsListRouteSchema = {
  tags: ["Working Groups"],
  summary: "List all working groups (admin)",
  description: "Unlike the public GET /api/v1/working-groups, includes inactive working groups.",
  responses: {
    "200": {
      description: "All working groups.",
      content: { "application/json": { schema: z.object({ workingGroups: z.array(adminWorkingGroupSummarySchema) }) } },
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

export const workingGroupMemberRemoveRouteSchema = {
  tags: ["Working Groups"],
  summary: "Remove a member from a working group",
  request: { params: workingGroupMemberParamsSchema },
  responses: {
    "200": { description: "Member removed." },
    "404": { description: "Working group not found." },
  },
};
