/**
 * Public form-submission read-model surface. The implementation is split by
 * use case while callers retain the original service import path.
 */
export { getFormByKey } from "./form-definition";
export { getFormSubmissionStats } from "./field-statistics";
export { listFormSubmissions } from "./submission-page";

export type {
  AdminSubmissionPayload,
  FieldRow,
  FieldStatPayload,
  FormRow,
  GetFormSubmissionStatsParams,
  GetFormSubmissionStatsResult,
  ListFormSubmissionsParams,
  ListFormSubmissionsResult,
} from "./types";
