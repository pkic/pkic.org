import type { z } from "zod";
import type {
  AdminFormSubmissionStatsQuery,
  AdminFormSubmissionsQuery,
  adminFormSubmissionSchema,
  adminFormSubmissionStatsResponseSchema,
  adminFormSubmissionStatSchema,
} from "../../../../assets/shared/schemas/admin-forms";
import type { FormFieldRow, FormRow as ManagedFormRow } from "../forms/read";

/** Database columns required to resolve the form-submission population. */
export type FormRow = Pick<ManagedFormRow, "id" | "key" | "title" | "purpose" | "scope_type" | "scope_ref">;

/** Database columns required to render answer statistics. */
export type FieldRow = Pick<FormFieldRow, "key" | "options_json">;

export type AdminSubmissionPayload = z.infer<typeof adminFormSubmissionSchema>;
export type FieldStatPayload = z.infer<typeof adminFormSubmissionStatSchema>;

export type FormSubmissionFilters = { formKey: string } & Pick<
  AdminFormSubmissionStatsQuery,
  "status" | "attendanceType" | "eventSlug" | "q"
>;
export type ListFormSubmissionsParams = FormSubmissionFilters &
  Pick<AdminFormSubmissionsQuery, "sort" | "limit" | "offset">;
export type ListFormSubmissionsResult = {
  form: z.infer<typeof adminFormSubmissionStatsResponseSchema>["form"];
  total: number;
  offset: number;
  limit: number;
  submissions: AdminSubmissionPayload[];
};
export type GetFormSubmissionStatsParams = FormSubmissionFilters;
export type GetFormSubmissionStatsResult = z.infer<typeof adminFormSubmissionStatsResponseSchema>;
