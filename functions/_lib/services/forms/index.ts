export {
  getActiveFormByPurpose,
  getActiveEventFormByPurpose,
  getActiveFormForResolution,
  getGlobalFormByKey,
  getFormDefinitionByPlacement,
  getManagedFormWithFields,
  mapManagedFormFields,
  parseFormFieldOptionSource,
  resolveFormFieldOptionCatalogs,
  type ActiveFormDefinition,
  type ManagedFormWithFields,
  type FormFieldDefinition,
  type EventFormResolution,
} from "./read";
export type { FormPurpose } from "../../../../assets/shared/schemas/forms";

export { getGroupFormDefinition, listGroupFormPlacements, type GroupFormViewer } from "./group-placement-read";
export { updateGroupFormPlacement } from "./group-placement-mutation";
export { createGroupFormDefinition, updateGroupFormDefinition } from "./group-definition-mutation";
export { submitGroupFormResponse } from "./group-response-submission";
export { getGroupFormResponseStatistics, listGroupFormResponses } from "./group-response-reporting";

export {
  validateCustomAnswersAgainstForm,
  validateCustomAnswersByPurpose,
  validateCustomAnswersForSubmission,
  type CustomAnswerValue,
  type DateRangeAnswer,
  type ValidatedCustomAnswers,
  type ValidationContext,
} from "./validation";

export { listAdminForms, type AdminFormSummaryRow } from "./list";

export { createManagedForm, prepareManagedForm, removeManagedForm, updateManagedForm } from "./management";
export type { ManagedFormRemovalAction } from "./management";

export {
  createManagedFormPlacement,
  findActiveFormPlacement,
  findFormPlacement,
  listFormPlacements,
  requireActiveFormPlacement,
  updateManagedFormPlacement,
} from "./placements";

export {
  prepareCreateFormSubmission,
  prepareFormAnswerMutations,
  formSubmissionContextChangedError,
  isFormSubmissionContextConflict,
  prepareFormRevisionGuard,
  prepareFormSubmissionGuard,
  prepareReplaceContextFormSubmission,
  prepareUpdateFormSubmission,
} from "./submission-command";
