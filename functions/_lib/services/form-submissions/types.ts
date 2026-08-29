import type { z } from "zod";
import type {
  FormSubmissionStatsQuery,
  FormSubmissionsQuery,
  formSubmissionSchema,
  formSubmissionStatsResponseSchema,
  formSubmissionStatSchema,
} from "../../../../assets/shared/schemas/form-management";
import type { FormFieldRow, FormRow as ManagedFormRow } from "../forms/read";

/** Database columns required to resolve the form-submission population. */
export type FormRow = Pick<ManagedFormRow, "id" | "key" | "title" | "purpose" | "scope_type" | "scope_ref">;

/** Database columns required to render answer statistics. */
export type FieldRow = Pick<FormFieldRow, "id" | "key" | "options_json" | "option_source">;

export type SubmissionPayload = z.infer<typeof formSubmissionSchema>;
export type FieldStatPayload = z.infer<typeof formSubmissionStatSchema>;

export type FormSubmissionFilters = { formKey: string } & Pick<
  FormSubmissionStatsQuery,
  "placementId" | "status" | "attendanceType" | "eventSlug" | "q"
> & { unownedOnly?: boolean; installationOnly?: boolean };
export type ListFormSubmissionsParams = FormSubmissionFilters & Pick<FormSubmissionsQuery, "sort" | "limit" | "offset">;
export type ListFormSubmissionsResult = {
  form: z.infer<typeof formSubmissionStatsResponseSchema>["form"];
  total: number;
  offset: number;
  limit: number;
  submissions: SubmissionPayload[];
};
export type GetFormSubmissionStatsParams = FormSubmissionFilters;
export type GetFormSubmissionStatsResult = z.infer<typeof formSubmissionStatsResponseSchema>;
