import { z } from "zod";
import {
  listQuerySchema,
  paginatedResponseSchema,
  searchQuerySchema,
  searchableListQuerySchema,
  sortColumnSchema,
} from "./pagination";
import { booleanQueryFlagSchema, successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { formFieldDefinitionSchema, formPlacementSchema, formPurposeSchema, formStatusSchema } from "./forms";

export const FORM_SUBMISSIONS_SORT_COLUMNS = ["submitter", "status", "submitted_at"] as const;
export const formSubmissionsSortValueSchema = sortColumnSchema(FORM_SUBMISSIONS_SORT_COLUMNS);

export const FORMS_SORT_COLUMNS = [
  "key",
  "title",
  "purpose",
  "status",
  "scopeType",
  "updatedAt",
  "submissionCount",
] as const;

export const formsListQuerySchema = listQuerySchema(FORMS_SORT_COLUMNS, { limit: 200 }).extend({
  purpose: formPurposeSchema.optional(),
  status: formStatusSchema.optional(),
});
export type FormsListQuery = z.infer<typeof formsListQuerySchema>;
export const eventFormsListQuerySchema = formsListQuerySchema.extend({
  linkedOnly: booleanQueryFlagSchema.optional(),
});
export type EventFormsListQuery = z.infer<typeof eventFormsListQuerySchema>;

/** Canonical persisted form shape used by detail and mutation responses. */
export const formRecordSchema = z.object({
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
export const formSummarySchema = formRecordSchema.extend({
  event_slug: z.string().nullable(),
  event_name: z.string().nullable(),
  field_count: z.number(),
  placement_count: z.number(),
  submission_count: z.number(),
});
export type FormSummary = z.infer<typeof formSummarySchema>;
export const formDetailResponseSchema = z.object({
  form: formRecordSchema,
  fields: z.array(formFieldDefinitionSchema),
});
export type FormDetailResponse = z.infer<typeof formDetailResponseSchema>;
export const formUpdateResponseSchema = successResponseSchema.extend(formDetailResponseSchema.shape);
export const formDeleteResponseSchema = z.object({ action: z.string(), message: z.string().optional() });
export const formCreateResponseSchema = successResponseSchema.extend({
  formId: databaseIdSchema,
  placementId: databaseIdSchema,
  key: z.string(),
});

export const formsListResponseSchema = paginatedResponseSchema("forms", formSummarySchema);

const formSubmissionFiltersSchema = z.object({
  placementId: databaseIdSchema.optional(),
  status: z.string().trim().max(50).optional(),
  attendanceType: z.string().trim().max(50).optional(),
  eventSlug: z.string().trim().min(1).max(200).optional(),
});

export const formSubmissionsQuerySchema = searchableListQuerySchema(formSubmissionsSortValueSchema, {
  limit: 200,
}).merge(formSubmissionFiltersSchema);
export type FormSubmissionsQuery = z.infer<typeof formSubmissionsQuerySchema>;

export const formSubmissionStatsQuerySchema = searchQuerySchema.merge(formSubmissionFiltersSchema);
export type FormSubmissionStatsQuery = z.infer<typeof formSubmissionStatsQuerySchema>;

export const formSubmissionSubmitterSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  organization: z.string().nullable(),
});

export const formSubmissionSchema = z.object({
  id: z.string(),
  status: z.string(),
  submittedAt: z.string(),
  contextType: z.string().nullable(),
  contextRef: z.string().nullable(),
  submitter: formSubmissionSubmitterSchema.nullable(),
  answers: z.record(z.string(), z.unknown()),
});

export const formSubmissionStatEntrySchema = z.object({
  label: z.string(),
  count: z.number(),
  percent: z.number(),
  weight: z.number(),
});

export const formSubmissionStatSchema = z.object({
  fieldKey: z.string(),
  totalAnswers: z.number(),
  uniqueAnswers: z.number(),
  entries: z.array(formSubmissionStatEntrySchema),
});

const formReferenceSchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  purpose: formPurposeSchema,
  placement: formPlacementSchema.nullable(),
});

export const formSubmissionsResponseSchema = paginatedResponseSchema("submissions", formSubmissionSchema).extend({
  form: formReferenceSchema,
});
export type FormSubmissionsResponse = z.infer<typeof formSubmissionsResponseSchema>;

export const formSubmissionStatsResponseSchema = z.object({
  form: formReferenceSchema,
  total: z.number().int().nonnegative(),
  stats: z.array(formSubmissionStatSchema),
});

export type FormSubmission = z.infer<typeof formSubmissionSchema>;
