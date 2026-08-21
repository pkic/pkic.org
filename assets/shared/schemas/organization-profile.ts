import { z } from "zod";
import { linksSchema } from "./links";

/** Shared response contract for organization cards and list rows. */
export const organizationProfileSummaryFieldsSchema = z.object({
  website: z.string().nullable(),
  description: z.string().nullable(),
  slogan: z.string().nullable(),
  logoUrl: z.string().nullable(),
});

export const organizationProfileLongContentSchema = z.string().nullable();

/** Shared response contract for the extended organization profile. */
export const organizationProfileExtendedFieldsSchema = z.object({
  contentMarkdown: organizationProfileLongContentSchema,
  blogUrl: z.string().nullable(),
  blogFeedUrl: z.string().nullable(),
  pressUrl: z.string().nullable(),
  pressFeedUrl: z.string().nullable(),
  careersUrl: z.string().nullable(),
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
  website: z.url().nullable().optional(),
  blogUrl: z.url().nullable().optional(),
  blogFeedUrl: z.url().nullable().optional(),
  pressUrl: z.url().nullable().optional(),
  pressFeedUrl: z.url().nullable().optional(),
  careersUrl: z.url().nullable().optional(),
  links: linksSchema.optional(),
});

export type OrganizationEditableContent = z.infer<typeof organizationEditableContentSchema>;
