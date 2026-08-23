import { z } from "zod";
import {
  listQuerySchema,
  paginatedResponseSchema,
  searchQuerySchema,
  searchableListQuerySchema,
  sortColumnSchema,
} from "./pagination";
import { trimmedString } from "./api-common";
import { addDuplicateStringIssues } from "./refinements";
import { formFieldRulesSchema } from "./form-field-rules";
import { formFieldDefinitionSchema, formFieldTypeSchema, formPurposeSchema, formStatusSchema } from "./forms";

export const FORM_SUBMISSIONS_SORT_COLUMNS = ["submitter", "status", "submitted_at"] as const;
export const formSubmissionsSortValueSchema = sortColumnSchema(FORM_SUBMISSIONS_SORT_COLUMNS);

export const adminFormFieldInputSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9_]*$/),
  label: trimmedString(1, 200),
  fieldType: formFieldTypeSchema,
  required: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  options: z.array(z.string().trim().min(1).max(500)).max(200).optional(),
  validation: formFieldRulesSchema.optional(),
});

function addDuplicateFormFieldIssues(value: { fields?: Array<{ key: string }> }, ctx: z.RefinementCtx): void {
  addDuplicateStringIssues(value.fields ?? [], ctx, {
    value: (field) => field.key,
    path: (index) => ["fields", index, "key"],
    label: "Field key",
  });
}

export const adminFormCreateSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z][a-z0-9-]*$/),
    purpose: formPurposeSchema,
    title: trimmedString(2, 200),
    description: trimmedString(2, 1000).optional(),
    status: formStatusSchema.default("active"),
    fields: z.array(adminFormFieldInputSchema).max(50).default([]),
  })
  .superRefine(addDuplicateFormFieldIssues);

export const adminFormUpdateSchema = z
  .object({
    title: trimmedString(2, 200).optional(),
    description: trimmedString(2, 1000).nullable().optional(),
    status: formStatusSchema.optional(),
    fields: z.array(adminFormFieldInputSchema).max(50).optional(),
  })
  .superRefine(addDuplicateFormFieldIssues);

export type AdminFormCreateInput = z.infer<typeof adminFormCreateSchema>;
export type AdminFormUpdateInput = z.infer<typeof adminFormUpdateSchema>;

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

export const adminFormSummarySchema = z.object({
  id: z.string(),
  key: z.string(),
  scope_type: z.string(),
  scope_ref: z.string().nullable(),
  event_slug: z.string().nullable(),
  event_name: z.string().nullable(),
  purpose: formPurposeSchema,
  status: formStatusSchema,
  title: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  field_count: z.number(),
  submission_count: z.number(),
});
export type AdminFormSummary = z.infer<typeof adminFormSummarySchema>;
export const adminFormDetailResponseSchema = z.object({
  form: adminFormSummarySchema,
  fields: z.array(formFieldDefinitionSchema),
});
export const adminFormDeleteResponseSchema = z.object({ action: z.string(), message: z.string().optional() });
export const adminFormCreateResponseSchema = z.object({ key: z.string() });

export const adminFormsListResponseSchema = paginatedResponseSchema("forms", adminFormSummarySchema);

const adminFormSubmissionFiltersSchema = z.object({
  status: z.string().trim().max(50).optional(),
  attendanceType: z.string().trim().max(50).optional(),
  eventSlug: z.string().trim().min(1).max(200).optional(),
});

export const adminFormSubmissionsQuerySchema = searchableListQuerySchema(formSubmissionsSortValueSchema, {
  limit: 200,
}).merge(adminFormSubmissionFiltersSchema);

export const adminFormSubmissionStatsQuerySchema = searchQuerySchema.merge(adminFormSubmissionFiltersSchema);

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
});

export const adminFormSubmissionsResponseSchema = paginatedResponseSchema(
  "submissions",
  adminFormSubmissionSchema,
).extend({ form: adminFormReferenceSchema });

export const adminFormSubmissionStatsResponseSchema = z.object({
  form: adminFormReferenceSchema,
  total: z.number().int().nonnegative(),
  stats: z.array(adminFormSubmissionStatSchema),
});

export type AdminFormSubmission = z.infer<typeof adminFormSubmissionSchema>;
