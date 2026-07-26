import { z } from "zod";

/** Schemas for the public member directory & working groups endpoints (PRD §1.5). */

export const publicMemberSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  memberType: z.string(),
  tier: z.string().nullable(),
  website: z.string().nullable(),
  description: z.string().nullable(),
  logoUrl: z.string().nullable(),
  memberSince: z.string(),
});

export const membersListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const membersListResponseSchema = z.object({
  members: z.array(publicMemberSummarySchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});

export const membersListRouteSchema = {
  tags: ["Members"],
  summary: "Public member directory",
  description: "Paginated, publicly readable member directory. D1 is the source of truth (PRD §1.6).",
  request: { query: membersListQuerySchema },
  responses: {
    "200": {
      description: "Paginated member list.",
      content: { "application/json": { schema: membersListResponseSchema } },
    },
  },
};

export const memberDetailRouteSchema = {
  tags: ["Members"],
  summary: "Public member profile",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": {
      description: "Public member profile.",
      content: { "application/json": { schema: publicMemberSummarySchema } },
    },
    "404": { description: "Member not found." },
  },
};

export const workingGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
});

export const workingGroupsListResponseSchema = z.object({
  workingGroups: z.array(workingGroupSummarySchema),
});

export const workingGroupsListRouteSchema = {
  tags: ["Working Groups"],
  summary: "List working groups",
  responses: {
    "200": {
      description: "Active working groups.",
      content: { "application/json": { schema: workingGroupsListResponseSchema } },
    },
  },
};

export const workingGroupDetailSchema = workingGroupSummarySchema.extend({
  mailingListEmail: z.string().nullable(),
  members: z.array(z.object({ name: z.string(), organizationName: z.string().nullable() })),
});

export const workingGroupDetailRouteSchema = {
  tags: ["Working Groups"],
  summary: "Working group detail",
  description: "Detail plus a public subset of the member list. :id accepts either the working group UUID or its slug.",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": {
      description: "Working group detail.",
      content: { "application/json": { schema: workingGroupDetailSchema } },
    },
    "404": { description: "Working group not found." },
  },
};
