export {
  getActiveFormByPurpose,
  getGlobalFormByKey,
  getManagedFormWithFields,
  mapManagedFormFields,
  type ActiveFormDefinition,
  type ManagedFormWithFields,
  type FormFieldDefinition,
} from "./read";
export type { FormPurpose } from "../../../../assets/shared/schemas/forms";

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

export { createManagedForm, removeManagedForm, updateManagedForm } from "./management";
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
