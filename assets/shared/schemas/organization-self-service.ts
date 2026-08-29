import { z } from "zod";
import { successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { listQuerySchema, paginatedResponseSchema } from "./pagination";
import {
  contentReviewStatusSchema,
  organizationContentReviewSchema,
  organizationEditableContentSchema,
  organizationProfileContentFieldsSchema,
} from "./organization-profile";

export const organizationSelfServiceParamsSchema = z.object({ organizationId: databaseIdSchema });

export const organizationMemberProfileSchema = z
  .object({
    id: databaseIdSchema,
    name: z.string(),
    isOrgContact: z.boolean(),
    isPrimaryContact: z.boolean(),
    pendingSecondaryContactUserId: databaseIdSchema.nullable(),
    pendingReview: organizationContentReviewSchema.nullable(),
  })
  .extend(organizationProfileContentFieldsSchema.shape);
export const organizationMemberProfileResponseSchema = z.object({ organization: organizationMemberProfileSchema });

export const organizationMemberProfileGetRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true },
  summary: "Get the active member's organization profile",
  request: { params: organizationSelfServiceParamsSchema },
  responses: {
    "200": {
      description: "The organization profile and caller-specific capabilities.",
      content: { "application/json": { schema: organizationMemberProfileResponseSchema } },
    },
    "404": { description: "The organization is not bound to the active membership." },
  },
};

export const organizationContentReviewCreateSchema = organizationEditableContentSchema;
export const organizationContentReviewCreateResponseSchema = z.object({ review: organizationContentReviewSchema });
export const organizationContentReviewCreateRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true },
  summary: "Submit organization content changes for review",
  description:
    "Only an active primary or secondary contact may submit. The live profile remains unchanged until review approval.",
  request: {
    params: organizationSelfServiceParamsSchema,
    body: { content: { "application/json": { schema: organizationContentReviewCreateSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Submitted for review.",
      content: { "application/json": { schema: organizationContentReviewCreateResponseSchema } },
    },
    "403": { description: "An organization contact is required." },
    "404": { description: "The organization is not bound to the active membership." },
    "409": { description: "A submission is already pending or authorization changed." },
    "422": { description: "No editable fields were submitted." },
  },
};

export const organizationContentReviewsListQuerySchema = listQuerySchema(["submittedAt", "status"] as const).extend({
  status: z.union([contentReviewStatusSchema, z.literal("history")]).default("history"),
});
export type OrganizationContentReviewsListQuery = z.infer<typeof organizationContentReviewsListQuerySchema>;
export const organizationContentReviewsListResponseSchema = paginatedResponseSchema(
  "reviews",
  organizationContentReviewSchema,
);
export const organizationContentReviewsListRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true },
  summary: "List organization content reviews",
  request: { params: organizationSelfServiceParamsSchema, query: organizationContentReviewsListQuerySchema },
  responses: {
    "200": {
      description: "A bounded review history page.",
      content: { "application/json": { schema: organizationContentReviewsListResponseSchema } },
    },
    "404": { description: "The organization is not bound to the active membership." },
  },
};

export const organizationContentReviewParamsSchema = organizationSelfServiceParamsSchema.extend({
  reviewId: databaseIdSchema,
});
export const organizationContentReviewWithdrawRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true },
  summary: "Withdraw a pending organization content review",
  request: { params: organizationContentReviewParamsSchema },
  responses: {
    "200": { description: "Withdrawn.", content: { "application/json": { schema: successResponseSchema } } },
    "404": { description: "Review not found." },
    "409": { description: "The review is no longer pending or authorization changed." },
  },
};

export const organizationLogoReviewResponseSchema = successResponseSchema;
export const organizationLogoReviewCreateRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true },
  summary: "Submit a replacement organization logo for review",
  description:
    "Accepts a JPEG, PNG, or WebP body up to 5 MB. The image remains staged until the content review is approved.",
  request: { params: organizationSelfServiceParamsSchema },
  responses: {
    "200": {
      description: "Logo staged for review.",
      content: { "application/json": { schema: organizationLogoReviewResponseSchema } },
    },
    "403": { description: "An organization contact is required." },
    "404": { description: "The organization is not bound to the active membership." },
    "409": { description: "The pending review or authorization changed." },
    "413": { description: "File too large." },
    "415": { description: "Unsupported file type." },
  },
};

export const organizationSecondaryContactNominationSchema = z.object({ userId: databaseIdSchema });
export const organizationSecondaryContactNominationResponseSchema = z.object({
  pendingSecondaryContactUserId: databaseIdSchema.nullable(),
});
export const organizationSecondaryContactNominationPutRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true },
  summary: "Create or replace a secondary-contact nomination",
  description: "Only the active primary contact may nominate another active representative.",
  request: {
    params: organizationSelfServiceParamsSchema,
    body: { content: { "application/json": { schema: organizationSecondaryContactNominationSchema } }, required: true },
  },
  responses: {
    "200": {
      description: "Nomination recorded.",
      content: { "application/json": { schema: organizationSecondaryContactNominationResponseSchema } },
    },
    "403": { description: "The active primary contact is required." },
    "422": { description: "The nominee is not an eligible representative." },
  },
};
export const organizationSecondaryContactNominationDeleteRouteSchema = {
  tags: ["Organizations"],
  "x-pkic-auth": { required: true },
  summary: "Withdraw the pending secondary-contact nomination",
  request: { params: organizationSelfServiceParamsSchema },
  responses: {
    "200": {
      description: "Nomination withdrawn.",
      content: { "application/json": { schema: organizationSecondaryContactNominationResponseSchema } },
    },
    "403": { description: "The active primary contact is required." },
  },
};

export const organizationActiveSponsorshipSchema = z.object({
  tier: z.string().nullable(),
  startDate: z.string().nullable(),
});
export const organizationActiveSponsorshipResponseSchema = z.object({
  sponsorship: organizationActiveSponsorshipSchema,
});
export const organizationActiveSponsorshipGetRouteSchema = {
  tags: ["Organizations", "Sponsorships"],
  "x-pkic-auth": { required: true },
  summary: "Get the organization's active consortium sponsorship",
  request: { params: organizationSelfServiceParamsSchema },
  responses: {
    "200": {
      description: "Current sponsorship values; both are null when no sponsorship is active.",
      content: { "application/json": { schema: organizationActiveSponsorshipResponseSchema } },
    },
    "404": { description: "The organization is not bound to the active membership." },
  },
};
