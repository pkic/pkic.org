import { z } from "zod";
import {
  listQuerySchema,
  paginatedResponseSchema,
  searchQuerySchema,
  searchableListQuerySchema,
  sortColumnSchema,
} from "./pagination";
import { successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { formFieldDefinitionSchema, formPlacementSchema, formPurposeSchema, formStatusSchema } from "./forms";

export const FORM_SUBMISSIONS_SORT_COLUMNS = ["submitter", "status", "submitted_at"] as const;
export const formSubmissionsSortValueSchema = sortColumnSchema(FORM_SUBMISSIONS_SORT_COLUMNS);

export const ADMIN_FORMS_SORT_COLUMNS = [
  "key",
  "title",
  "purpose",
  "status",
  "scopeType",
  "updatedAt",
  "submissionCount",
] as const;

export const adminFormsListQuerySchema = listQuerySchema(ADMIN_FORMS_SORT_COLUMNS, { limit: 200 }).extend({
  purpose: formPurposeSchema.optional(),
  status: formStatusSchema.optional(),
});
export type AdminFormsListQuery = z.infer<typeof adminFormsListQuerySchema>;

/** Canonical persisted form shape used by detail and mutation responses. */
export const adminFormRecordSchema = z.object({
  id: databaseIdSchema,
  key: z.string(),
  scope_type: z.string(),
  scope_ref: z.string().nullable(),
  purpose: formPurposeSchema,
  status: formStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

/** List-only projection extending the persisted form with joins and aggregates. */
export const adminFormSummarySchema = adminFormRecordSchema.extend({
  event_slug: z.string().nullable(),
  event_name: z.string().nullable(),
  field_count: z.number(),
  placement_count: z.number(),
  submission_count: z.number(),
});
export type AdminFormSummary = z.infer<typeof adminFormSummarySchema>;
export const adminFormDetailResponseSchema = z.object({
  form: adminFormRecordSchema,
  fields: z.array(formFieldDefinitionSchema),
});
export type AdminFormDetailResponse = z.infer<typeof adminFormDetailResponseSchema>;
export const adminFormUpdateResponseSchema = successResponseSchema.extend(adminFormDetailResponseSchema.shape);
export const adminFormDeleteResponseSchema = z.object({ action: z.string(), message: z.string().optional() });
export const adminFormCreateResponseSchema = successResponseSchema.extend({
  formId: databaseIdSchema,
  placementId: databaseIdSchema,
  key: z.string(),
});

export const adminFormsListResponseSchema = paginatedResponseSchema("forms", adminFormSummarySchema);

const adminFormSubmissionFiltersSchema = z.object({
  placementId: databaseIdSchema.optional(),
  status: z.string().trim().max(50).optional(),
  attendanceType: z.string().trim().max(50).optional(),
  eventSlug: z.string().trim().min(1).max(200).optional(),
});

export const adminFormSubmissionsQuerySchema = searchableListQuerySchema(formSubmissionsSortValueSchema, {
  limit: 200,
}).merge(adminFormSubmissionFiltersSchema);
export type AdminFormSubmissionsQuery = z.infer<typeof adminFormSubmissionsQuerySchema>;

export const adminFormSubmissionStatsQuerySchema = searchQuerySchema.merge(adminFormSubmissionFiltersSchema);
export type AdminFormSubmissionStatsQuery = z.infer<typeof adminFormSubmissionStatsQuerySchema>;

export const adminFormSubmissionSubmitterSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  organization: z.string().nullable(),
});

export const adminFormSubmissionSchema = z.object({
  id: z.string(),
  status: z.string(),
  submittedAt: z.string(),
  contextType: z.string().nullable(),
  contextRef: z.string().nullable(),
  submitter: adminFormSubmissionSubmitterSchema.nullable(),
  answers: z.record(z.string(), z.unknown()),
});

export const adminFormSubmissionStatEntrySchema = z.object({
  label: z.string(),
  count: z.number(),
  percent: z.number(),
  weight: z.number(),
});

export const adminFormSubmissionStatSchema = z.object({
  fieldKey: z.string(),
  totalAnswers: z.number(),
  uniqueAnswers: z.number(),
  entries: z.array(adminFormSubmissionStatEntrySchema),
});

const adminFormReferenceSchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  purpose: formPurposeSchema,
  placement: formPlacementSchema.nullable(),
});

export const adminFormSubmissionsResponseSchema = paginatedResponseSchema(
  "submissions",
  adminFormSubmissionSchema,
).extend({ form: adminFormReferenceSchema });
export type AdminFormSubmissionsResponse = z.infer<typeof adminFormSubmissionsResponseSchema>;

export const adminFormSubmissionStatsResponseSchema = z.object({
  form: adminFormReferenceSchema,
  total: z.number().int().nonnegative(),
  stats: z.array(adminFormSubmissionStatSchema),
});

export type AdminFormSubmission = z.infer<typeof adminFormSubmissionSchema>;
