/**
 * Public form-submission read-model surface. The implementation is split by
 * use case while callers retain the original service import path.
 */
export { getFormByKey } from "./form-definition";
export { getFormSubmissionStats } from "./field-statistics";
export {
  getInstallationFormSubmissionStats,
  listInstallationFormSubmissions,
  requireInstallationFormResponseSet,
} from "./installation-response-set";
export { listFormSubmissions } from "./submission-page";

export type {
  SubmissionPayload,
  FieldRow,
  FieldStatPayload,
  FormRow,
  GetFormSubmissionStatsParams,
  GetFormSubmissionStatsResult,
  ListFormSubmissionsParams,
  ListFormSubmissionsResult,
} from "./types";
export type { ListInstallationFormSubmissionsParams } from "./installation-response-set";
