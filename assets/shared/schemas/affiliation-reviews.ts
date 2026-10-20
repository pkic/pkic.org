import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

/**
 * Organization names and titles the identity migration could not attach to
 * an identity. They are grouped by the name as written (normalized spelling),
 * so staff see how many people wrote it and on which work domains, and can
 * dismiss a group at once. A title written without an organization groups by
 * its person. A review is resolved when its person joins an organization
 * through their verified work address; nobody is linked by the text alone.
 */
/** `registration`: an organization a confirmed registrant named that the affiliation rule could not link. */
export const AFFILIATION_REVIEW_SOURCE_TYPES = ["user_profile", "proposal_speaker", "registration"] as const;
export const affiliationReviewSourceTypeSchema = z.enum(AFFILIATION_REVIEW_SOURCE_TYPES);

export const AFFILIATION_REVIEW_STATUSES = ["open", "resolved", "dismissed"] as const;
export const affiliationReviewStatusSchema = z.enum(AFFILIATION_REVIEW_STATUSES);
export type AffiliationReviewStatus = z.infer<typeof affiliationReviewStatusSchema>;

export const affiliationReviewGroupKeySchema = z.string().trim().min(1).max(400);

/** One person's text as written, inside a group. */
export const affiliationReviewSchema = z.object({
  id: databaseIdSchema,
  groupKey: affiliationReviewGroupKeySchema,
  userId: databaseIdSchema,
  personName: z.string(),
  personEmail: z.string(),
  organizationName: z.string().nullable(),
  jobTitle: z.string().nullable(),
  /** The person's verified work domain, when they had one. */
  emailDomain: z.string().nullable(),
  sourceType: affiliationReviewSourceTypeSchema,
  status: affiliationReviewStatusSchema,
  resolvedIdentityId: databaseIdSchema.nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type AffiliationReview = z.infer<typeof affiliationReviewSchema>;

/** Everyone who wrote the same name, decided together. */
export const affiliationReviewGroupSchema = z.object({
  groupKey: affiliationReviewGroupKeySchema,
  /** The spelling most of the group wrote. */
  organizationName: z.string().nullable(),
  /** The title, for a group that names no organization. */
  jobTitle: z.string().nullable(),
  emailDomains: z.array(z.string()),
  people: z.number().int().nonnegative(),
  openReviews: z.number().int().nonnegative(),
  status: affiliationReviewStatusSchema,
  firstRecordedAt: z.string(),
});
export type AffiliationReviewGroup = z.infer<typeof affiliationReviewGroupSchema>;

export const AFFILIATION_REVIEW_GROUP_SORT_COLUMNS = ["people", "organizationName", "firstRecordedAt"] as const;
export const affiliationReviewGroupsListQuerySchema = listQuerySchema(AFFILIATION_REVIEW_GROUP_SORT_COLUMNS).extend({
  status: affiliationReviewStatusSchema.optional(),
});
export type AffiliationReviewGroupsListQuery = z.infer<typeof affiliationReviewGroupsListQuerySchema>;
export const affiliationReviewGroupsListResponseSchema = paginatedResponseSchema(
  "groups",
  affiliationReviewGroupSchema,
);

export const AFFILIATION_REVIEW_SORT_COLUMNS = ["createdAt", "personName"] as const;
export const affiliationReviewsListQuerySchema = listQuerySchema(AFFILIATION_REVIEW_SORT_COLUMNS).extend({
  status: affiliationReviewStatusSchema.optional(),
  groupKey: affiliationReviewGroupKeySchema.optional(),
});
export type AffiliationReviewsListQuery = z.infer<typeof affiliationReviewsListQuerySchema>;
export const affiliationReviewsListResponseSchema = paginatedResponseSchema("reviews", affiliationReviewSchema);

export const affiliationReviewGroupParamsSchema = z.object({ groupKey: affiliationReviewGroupKeySchema });

export const affiliationReviewGroupResponseSchema = z.object({ group: affiliationReviewGroupSchema });

/** A group after a decision, and how many of its open reviews the decision closed. */
export const affiliationReviewGroupDecisionResponseSchema = z.object({
  group: affiliationReviewGroupSchema,
  decided: z.number().int().nonnegative(),
});

const STAFF_READ = { "x-pkic-auth": { required: true, scopes: ["users:read"] } };
const STAFF_WRITE = { "x-pkic-auth": { required: true, scopes: ["users:write"] } };
const GROUP_DECISION_RESPONSES = {
  "200": {
    description: "The group after the decision.",
    content: { "application/json": { schema: affiliationReviewGroupDecisionResponseSchema } },
  },
  "401": { description: "Portal authentication required." },
  "403": { description: "Users write permission required." },
  "404": { description: "Group or organization not found." },
  "409": { description: "The group has no open reviews left." },
};

export const affiliationReviewsListRouteSchema = {
  tags: ["Identities"],
  summary: "List affiliation reviews",
  description: "The individual texts awaiting an identity, optionally within one group. Defaults to open reviews.",
  ...STAFF_READ,
  request: { query: affiliationReviewsListQuerySchema },
  responses: {
    "200": {
      description: "Affiliation review page.",
      content: { "application/json": { schema: affiliationReviewsListResponseSchema } },
    },
    "401": { description: "Portal authentication required." },
    "403": { description: "Users read permission required." },
  },
};

export const affiliationReviewGroupsListRouteSchema = {
  tags: ["Identities"],
  summary: "List affiliation review groups",
  description:
    "Staff queue of affiliation text no identity represents, one row per name as its fuzzy key groups it, with the number of people who wrote it. Defaults to groups with open reviews.",
  ...STAFF_READ,
  request: { query: affiliationReviewGroupsListQuerySchema },
  responses: {
    "200": {
      description: "Affiliation review group page.",
      content: { "application/json": { schema: affiliationReviewGroupsListResponseSchema } },
    },
    "401": { description: "Portal authentication required." },
    "403": { description: "Users read permission required." },
  },
};

export const affiliationReviewGroupGetRouteSchema = {
  tags: ["Identities"],
  summary: "Get one affiliation review group",
  ...STAFF_READ,
  request: { params: affiliationReviewGroupParamsSchema },
  responses: {
    "200": {
      description: "Affiliation review group.",
      content: { "application/json": { schema: affiliationReviewGroupResponseSchema } },
    },
    "401": { description: "Portal authentication required." },
    "403": { description: "Users read permission required." },
    "404": { description: "Group not found." },
  },
};

export const affiliationReviewGroupDismissRouteSchema = {
  tags: ["Identities"],
  summary: "Dismiss every open review in a group",
  ...STAFF_WRITE,
  request: { params: affiliationReviewGroupParamsSchema },
  responses: GROUP_DECISION_RESPONSES,
};

/** A bounded pass, or one person's reviews. Cursors advance over skipped people too. */
export const affiliationReviewApproveSchema = z
  .object({
    userId: databaseIdSchema.optional(),
    afterUserId: databaseIdSchema.optional(),
  })
  .refine((value) => !(value.userId && value.afterUserId), { message: "Choose one person or a batch cursor" });
export type AffiliationReviewApprove = z.infer<typeof affiliationReviewApproveSchema>;
export const affiliationReviewApproveResponseSchema = z.object({
  group: affiliationReviewGroupSchema,
  decided: z.number().int().nonnegative(),
  nextUserId: databaseIdSchema.nullable(),
});
export const affiliationReviewGroupApproveRouteSchema = {
  tags: ["Identities"],
  summary: "Approve verified-domain affiliations in a bounded group pass",
  "x-pkic-auth": { required: true, scopes: ["users:write", "identities:activate"] },
  request: {
    params: affiliationReviewGroupParamsSchema,
    body: { required: true, content: { "application/json": { schema: affiliationReviewApproveSchema } } },
  },
  responses: {
    "200": {
      description: "Approved reviews and the next batch cursor; ineligible reviews stay open.",
      content: { "application/json": { schema: affiliationReviewApproveResponseSchema } },
    },
    "401": { description: "Portal authentication required." },
    "403": { description: "Users write and identity activation permissions required." },
    "404": { description: "Group not found." },
  },
};
