import { z } from "zod";
import { trimmedString } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import {
  CONTENT_REVIEW_STATUSES,
  contentReviewStatusSchema,
  organizationContentReviewSchema,
} from "./organization-profile";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";

export { CONTENT_REVIEW_STATUSES, contentReviewStatusSchema };

export const organizationContentReviewSummarySchema = organizationContentReviewSchema.extend({
  organizationName: z.string(),
  submitterName: z.string(),
  submitterEmail: z.string(),
});

export const ORGANIZATION_CONTENT_REVIEW_SORT_COLUMNS = [
  "organizationName",
  "submitterName",
  "status",
  "submittedAt",
] as const;

export const organizationContentReviewsListQuerySchema = listQuerySchema(
  ORGANIZATION_CONTENT_REVIEW_SORT_COLUMNS,
).extend({
  status: contentReviewStatusSchema.optional(),
});
export type OrganizationContentReviewsListQuery = z.infer<typeof organizationContentReviewsListQuerySchema>;
export const organizationContentReviewsListResponseSchema = paginatedResponseSchema(
  "reviews",
  organizationContentReviewSummarySchema,
);

export const organizationContentReviewsListRouteSchema = {
  tags: ["Organization content reviews"],
  summary: "List organization content moderation submissions",
  description: "Permission-scoped moderation queue. Defaults to pending submissions.",
  "x-pkic-auth": { required: true, scopes: ["organizations:content-review"] },
  request: { query: organizationContentReviewsListQuerySchema },
  responses: {
    "200": {
      description: "Organization content review page.",
      content: {
        "application/json": { schema: organizationContentReviewsListResponseSchema },
      },
    },
    "401": { description: "Portal authentication required." },
    "403": { description: "Organization content-review permission required." },
  },
};

export const organizationContentReviewDiffEntrySchema = z.object({
  field: z.string(),
  current: z.unknown(),
  proposed: z.unknown(),
});

export const organizationContentReviewDetailSchema = organizationContentReviewSummarySchema.extend({
  diff: z.array(organizationContentReviewDiffEntrySchema),
  logoStagingR2Key: z.string().nullable(),
  currentLogoR2Key: z.string().nullable(),
});
export const organizationContentReviewDetailResponseSchema = z.object({
  review: organizationContentReviewDetailSchema,
});
/** Decision endpoints return the transitioned review record, not a recomputed moderation detail. */
export const organizationContentReviewDecisionResponseSchema = z.object({
  review: organizationContentReviewSchema,
});

export type OrganizationContentReviewSummary = z.infer<typeof organizationContentReviewSummarySchema>;
export type OrganizationContentReviewDiffEntry = z.infer<typeof organizationContentReviewDiffEntrySchema>;
export type OrganizationContentReviewDetail = z.infer<typeof organizationContentReviewDetailSchema>;

export const organizationContentReviewIdParamsSchema = z.object({ id: databaseIdSchema });

export const organizationContentReviewGetRouteSchema = {
  tags: ["Organization content reviews"],
  summary: "Get an organization content review and its field diff",
  "x-pkic-auth": { required: true, scopes: ["organizations:content-review"] },
  request: { params: organizationContentReviewIdParamsSchema },
  responses: {
    "200": {
      description: "Organization content review detail.",
      content: { "application/json": { schema: organizationContentReviewDetailResponseSchema } },
    },
    "401": { description: "Portal authentication required." },
    "403": { description: "Organization content-review permission required." },
    "404": { description: "Review not found." },
  },
};

export const organizationContentReviewApproveRouteSchema = {
  tags: ["Organization content reviews"],
  summary: "Approve and publish an organization content submission",
  "x-pkic-auth": { required: true, scopes: ["organizations:content-review"] },
  request: { params: organizationContentReviewIdParamsSchema },
  responses: {
    "200": {
      description: "Approved review record.",
      content: { "application/json": { schema: organizationContentReviewDecisionResponseSchema } },
    },
    "401": { description: "Portal authentication required." },
    "403": { description: "Organization content-review permission required." },
    "404": { description: "Review not found." },
    "409": { description: "The review is no longer pending." },
  },
};

export const organizationContentReviewRejectSchema = z.object({
  reviewerNote: trimmedString(1, 2000),
});

export const organizationContentReviewRejectRouteSchema = {
  tags: ["Organization content reviews"],
  summary: "Reject an organization content submission",
  "x-pkic-auth": { required: true, scopes: ["organizations:content-review"] },
  request: {
    params: organizationContentReviewIdParamsSchema,
    body: {
      content: { "application/json": { schema: organizationContentReviewRejectSchema } },
      required: true,
    },
  },
  responses: {
    "200": {
      description: "Rejected review record.",
      content: { "application/json": { schema: organizationContentReviewDecisionResponseSchema } },
    },
    "401": { description: "Portal authentication required." },
    "403": { description: "Organization content-review permission required." },
    "404": { description: "Review not found." },
    "409": { description: "The review is no longer pending." },
  },
};
