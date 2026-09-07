import { z } from "zod";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import {
  organizationProfileExtendedFieldsSchema,
  organizationProfileLongContentSchema,
  organizationProfileSummaryFieldsSchema,
} from "./organization-profile";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";
import {
  INDIVIDUAL_MEMBERSHIP_CATEGORIES,
  membershipCategorySchema,
  memberStatusSchema,
} from "./membership-categories";

export { INDIVIDUAL_MEMBERSHIP_CATEGORIES };

/** Schemas for the public member directory endpoints. */

export const publicMemberSummarySchema = z
  .object({
    id: z.string(),
    slug: z.string().nullable(),
    name: z.string(),
    memberType: z.string(),
    tier: z.string().nullable(),
    memberSince: z.string(),
  })
  .extend(organizationProfileSummaryFieldsSchema.shape);

export type PublicMemberSummary = z.infer<typeof publicMemberSummarySchema>;

/** group: "organization" = org-tied categories (A-G, H1-H4, H8); "independent" = org-less H5/H6/H7 */
export const MEMBERS_LIST_SORT_COLUMNS = [
  "name",
  "membershipCategory",
  "status",
  "representativeCount",
  "memberSince",
] as const;
export const membersListQuerySchema = listQuerySchema(MEMBERS_LIST_SORT_COLUMNS).extend({
  group: z.enum(["all", "organization", "independent"]).default("all"),
  membershipCategory: membershipCategorySchema.optional(),
  /**
   * Staff only. The public directory always lists active members, so this
   * narrows nothing for a reader without `membership:read`.
   */
  status: memberStatusSchema.optional(),
  /**
   * Staff only. `none` finds a member nobody acts for — an organization whose
   * membership lapses after a grace period, and which nothing reaches until
   * then.
   */
  representatives: z.enum(["none", "some"]).optional(),
  /**
   * One membership by its aggregate id — the same list, narrowed to a single
   * row, for a surface that edits one. `groupMembershipsListQuerySchema`
   * narrows the same way rather than growing a second read model.
   */
  memberId: z.string().optional(),
});
export type MembersListQuery = z.infer<typeof membersListQuerySchema>;

/**
 * A member as staff see one: the aggregate, not the people inside it.
 *
 * Membership belongs to an organization or to an individual; an
 * organization's representatives inherit it rather than each holding one of
 * their own, so an organization with five people is one member, once. Beyond
 * the public projection this carries the standing and category that decide
 * what the member may do, and how many representatives currently act for it.
 */
export const staffMemberSummarySchema = z.object({
  /** The `members` aggregate id — what every membership command addresses. */
  id: z.string(),
  memberType: z.enum(["individual", "organization"]),
  name: z.string(),
  organizationId: z.string().nullable(),
  /** The person, for an individual member; null for an organization. */
  userId: z.string().nullable(),
  membershipCategory: membershipCategorySchema,
  /** The category's configured label, resolved where the category lives. */
  membershipCategoryLabel: z.string(),
  status: memberStatusSchema,
  /** Live identities acting for this member. One (or none) for an individual. */
  representativeCount: z.number().int().nonnegative(),
  memberSince: z.string(),
});
export type StaffMemberSummary = z.infer<typeof staffMemberSummarySchema>;

/**
 * A staff change to a membership itself: what category it is held under, and
 * whether it still stands. Ending a membership is a status, not a deletion —
 * a member the consortium once had is a fact its history keeps.
 */
export const memberUpdateSchema = z
  .object({
    membershipCategory: membershipCategorySchema.optional(),
    status: memberStatusSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "No fields to update",
  });
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;

export const memberUpdateResponseSchema = z.object({
  member: z.object({
    id: z.string(),
    memberType: z.enum(["individual", "organization"]),
    membershipCategory: membershipCategorySchema,
    status: memberStatusSchema,
  }),
});

export const memberUpdateRouteSchema = {
  tags: ["Members"],
  summary: "Update a membership",
  description:
    "Changes the category a membership is held under, or its standing. The subject is the membership itself — an " +
    "organization's or an individual's — not one identity acting under it; an organization's representatives " +
    "inherit both. Ending a membership sets its status rather than removing the record.",
  "x-pkic-auth": { required: true, scopes: ["membership:write"] },
  request: {
    params: z.object({ id: z.string() }),
    body: { required: true, content: { "application/json": { schema: memberUpdateSchema } } },
  },
  responses: {
    "200": {
      description: "Membership updated.",
      content: { "application/json": { schema: memberUpdateResponseSchema } },
    },
    "401": { description: "Staff authorization required." },
    "403": { description: "Membership write permission required." },
    "404": { description: "Membership not found." },
    "409": { description: "The membership changed while it was being updated." },
    "422": { description: "The category does not belong to this kind of membership." },
  },
};

export const publicMembersListResponseSchema = paginatedResponseSchema("members", publicMemberSummarySchema);
export const staffMembersListResponseSchema = paginatedResponseSchema("members", staffMemberSummarySchema);
/**
 * One endpoint, two projections, chosen by what the caller may see — the same
 * capability-shaped union `/api/v1/groups/:groupId/memberships` uses. A staff
 * reader gets every member with its standing; everybody else gets the public
 * directory, which is active members only.
 */
export const membersListResponseSchema = z.union([staffMembersListResponseSchema, publicMembersListResponseSchema]);
export type MembersListResponse = z.infer<typeof membersListResponseSchema>;

export const membersListRouteSchema = {
  tags: ["Members"],
  summary: "Member directory",
  description:
    "Paginated member list, one row per membership: an organization or an individual, never one per representative. " +
    "A caller with `membership:read` receives every member with its category, standing and representative count; " +
    "everybody else receives the public directory of active members. D1 is the source of truth.",
  request: { query: membersListQuerySchema },
  responses: {
    "200": {
      description: "Paginated member list.",
      content: { "application/json": { schema: membersListResponseSchema } },
    },
  },
};

export const memberWallQuerySchema = z.object({
  memberLimit: z.coerce.number().int().min(0).max(200).optional(),
});

export const memberWallEntrySchema = z.object({
  key: z.string(),
  href: httpOrSameOriginUrlSchema,
  logoUrl: httpOrSameOriginUrlSchema,
  name: z.string(),
  slogan: z.string().nullable(),
  sponsorLevel: z.number().int().min(0),
  sponsorLevelName: z.string().nullable(),
});

export const memberWallResponseSchema = z.object({ entries: z.array(memberWallEntrySchema) });
export type MemberWallEntry = z.infer<typeof memberWallEntrySchema>;

export const memberWallRouteSchema = {
  tags: ["Members"],
  summary: "Public member and sponsor logo wall",
  description: "Returns the unified, display-ready member and sponsor wall from one bounded D1 read model.",
  request: { query: memberWallQuerySchema },
  responses: {
    "200": {
      description: "Display-ready wall entries.",
      content: { "application/json": { schema: memberWallResponseSchema } },
    },
  },
};

export const publicMemberIdentitySchema = z.object({
  name: z.string(),
  jobTitle: z.string().nullable(),
  bio: z.string().nullable(),
  // The identity's owner-ordered featured profile link (links[0]), any platform.
  featuredLink: httpUrlSchema.nullable(),
  photoUrl: httpOrSameOriginUrlSchema.nullable(),
});

export const publicMemberDetailSchema = publicMemberSummarySchema.extend({
  ...organizationProfileExtendedFieldsSchema.omit({ contentMarkdown: true }).shape,
  content: organizationProfileLongContentSchema,
  // Populated for organization members from public active identities.
  // Empty for individual members; their identity profile is shown in the summary/detail fields.
  identities: z.array(publicMemberIdentitySchema),
  jobTitle: z.string().nullable(),
  // First entry of `links` — the owner-ordered featured profile link.
  featuredLink: httpUrlSchema.nullable(),
});
export type PublicMemberDetail = z.infer<typeof publicMemberDetailSchema>;

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
