import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { linksSchema } from "./links";
import { httpOrSameOriginUrlSchema, httpUrlSchema } from "./urls";

export const CONTENT_REVIEW_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export const contentReviewStatusSchema = z.enum(CONTENT_REVIEW_STATUSES);

/** Canonical review fields shared by member and staff response surfaces. */
export const organizationContentReviewSchema = z.object({
  id: databaseIdSchema,
  organizationId: databaseIdSchema,
  submittedByUserId: databaseIdSchema,
  proposedChanges: z.record(z.string(), z.unknown()),
  hasLogoChange: z.boolean(),
  status: contentReviewStatusSchema,
  reviewerUserId: databaseIdSchema.nullable(),
  reviewerNote: z.string().nullable(),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable(),
});

/** Shared response contract for organization cards and list rows. */
export const organizationProfileSummaryFieldsSchema = z.object({
  website: httpUrlSchema.nullable(),
  description: z.string().nullable(),
  slogan: z.string().nullable(),
  logoUrl: httpOrSameOriginUrlSchema.nullable(),
});

export const organizationProfileLongContentSchema = z.string().nullable();

/** Shared response contract for the extended organization profile. */
export const organizationProfileExtendedFieldsSchema = z.object({
  contentMarkdown: organizationProfileLongContentSchema,
  blogUrl: httpUrlSchema.nullable(),
  blogFeedUrl: httpUrlSchema.nullable(),
  pressUrl: httpUrlSchema.nullable(),
  pressFeedUrl: httpUrlSchema.nullable(),
  careersUrl: httpUrlSchema.nullable(),
  links: linksSchema,
});

export const organizationProfileContentFieldsSchema = organizationProfileSummaryFieldsSchema.extend(
  organizationProfileExtendedFieldsSchema.shape,
);

/** Canonical fields and limits accepted by either admin edits or member review submissions. */
export const organizationEditableContentSchema = z.object({
  slogan: z.string().trim().max(300).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  contentMarkdown: z.string().trim().max(20000).nullable().optional(),
  website: httpUrlSchema.nullable().optional(),
  blogUrl: httpUrlSchema.nullable().optional(),
  blogFeedUrl: httpUrlSchema.nullable().optional(),
  pressUrl: httpUrlSchema.nullable().optional(),
  pressFeedUrl: httpUrlSchema.nullable().optional(),
  careersUrl: httpUrlSchema.nullable().optional(),
  links: linksSchema.optional(),
});

export type OrganizationEditableContent = z.infer<typeof organizationEditableContentSchema>;
