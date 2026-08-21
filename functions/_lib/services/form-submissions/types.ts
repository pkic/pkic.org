import type { z } from "zod";
import type {
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
type FormReference = z.infer<typeof adminFormSubmissionStatsResponseSchema>["form"];

export interface FormSubmissionFilters {
  formKey: string;
  status: string;
  attendanceType: string;
  eventSlug: string;
  q?: string;
}

export interface ListFormSubmissionsParams extends FormSubmissionFilters {
  sort?: string;
  limit: number;
  offset: number;
}

export interface ListFormSubmissionsResult {
  form: FormReference;
  total: number;
  offset: number;
  limit: number;
  submissions: AdminSubmissionPayload[];
}

export type GetFormSubmissionStatsParams = FormSubmissionFilters;
export type GetFormSubmissionStatsResult = z.infer<typeof adminFormSubmissionStatsResponseSchema>;
