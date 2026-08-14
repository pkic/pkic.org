import { z } from "zod";

/** Schemas for the public member directory & working groups endpoints. */

export const publicMemberSummarySchema = z.object({
  id: z.string(),
  slug: z.string().nullable(),
  name: z.string(),
  memberType: z.string(),
  tier: z.string().nullable(),
  website: z.string().nullable(),
  description: z.string().nullable(),
  slogan: z.string().nullable(),
  logoUrl: z.string().nullable(),
  memberSince: z.string(),
});

/** group: "organization" = org-tied categories (A-G, H1-H4, H8); "independent" = org-less H5/H6/H7 */
export const membersListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  group: z.enum(["all", "organization", "independent"]).optional(),
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
  description: "Paginated, publicly readable member directory. D1 is the source of truth.",
  request: { query: membersListQuerySchema },
  responses: {
    "200": {
      description: "Paginated member list.",
      content: { "application/json": { schema: membersListResponseSchema } },
    },
  },
};

export const publicMemberRepresentativeSchema = z.object({
  name: z.string(),
  jobTitle: z.string().nullable(),
  bio: z.string().nullable(),
  linkedin: z.string().nullable(),
  photoUrl: z.string().nullable(),
});

export const publicMemberSocialSchema = z.object({
  x: z.string().nullable(),
  linkedin: z.string().nullable(),
  facebook: z.string().nullable(),
  instagram: z.string().nullable(),
  youtube: z.string().nullable(),
});

export const publicMemberDetailSchema = publicMemberSummarySchema.extend({
  content: z.string().nullable(),
  blogUrl: z.string().nullable(),
  blogFeedUrl: z.string().nullable(),
  pressUrl: z.string().nullable(),
  pressFeedUrl: z.string().nullable(),
  careersUrl: z.string().nullable(),
  social: publicMemberSocialSchema,
  // Populated for org-tied members from show_on_org_profile=1 representatives.
  // Empty for org-less individual members — their own bio/jobTitle live on the summary/detail fields directly.
  representatives: z.array(publicMemberRepresentativeSchema),
  jobTitle: z.string().nullable(),
  linkedin: z.string().nullable(),
});

export const memberLogoRouteSchema = {
  tags: ["Members"],
  summary: "Public organization logo",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": { description: "Logo image bytes." },
    "404": { description: "No logo on file." },
    "503": { description: "Asset storage is not configured." },
  },
};

export const memberDetailRouteSchema = {
  tags: ["Members"],
  summary: "Public member profile",
  request: { params: z.object({ id: z.string() }) },
  responses: {
    "200": {
      description: "Public member profile.",
      content: { "application/json": { schema: publicMemberDetailSchema } },
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

const workingGroupChairSchema = z.object({
  name: z.string(),
  organizationName: z.string().nullable(),
  organizationLogoUrl: z.string().nullable(),
  organizationWebsite: z.string().nullable(),
  photoUrl: z.string().nullable(),
  linkedin: z.string().nullable(),
});

export const workingGroupDetailSchema = workingGroupSummarySchema.extend({
  mailingListEmail: z.string().nullable(),
  members: z.array(z.object({ name: z.string(), organizationName: z.string().nullable() })),
  chair: workingGroupChairSchema.nullable(),
  viceChair: workingGroupChairSchema.nullable(),
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
