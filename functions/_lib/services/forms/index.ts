export {
  getActiveFormByPurpose,
  getActiveEventFormByPurpose,
  getActivePortalEventFormByPurpose,
  getActiveFormForEvent,
  getActiveFormForResolution,
  toEventFormResolutionEvent,
  getGlobalFormByKey,
  getFormDefinitionByPlacement,
  getManagedFormWithFields,
  requireManagedEventForm,
  mapManagedFormFields,
  parseFormFieldOptionSource,
  resolveFormFieldOptionCatalogs,
  type ActiveFormDefinition,
  type ManagedFormWithFields,
  type FormFieldDefinition,
  type EventFormResolution,
  type EventFormResolutionEvent,
} from "./read";
export type { FormPurpose } from "../../../../assets/shared/schemas/forms";

export {
  buildGroupFormPlacementsPageQuery,
  getGroupFormDefinition,
  listGroupFormPlacements,
  type GroupFormViewer,
} from "./group-placement-read";
export {
  buildMemberFormPlacementsPageQuery,
  listOpenFormPlacementsForMember,
  type MemberFormPlacementsQuery,
} from "./member-read-model";
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

export { listForms, type FormSummaryRow } from "./list";

export { createManagedForm, prepareManagedForm, removeManagedForm, updateManagedForm } from "./management";
export type { ManagedFormRemovalAction } from "./management";
export {
  prepareManagedFormPlacementTargetGuard,
  requireGlobalFormPlacementTargetBoundary,
  requireManagedFormMutationBoundary,
  requireManagedFormPlacementTargetBoundary,
} from "./management-boundary";
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

export {
  resolveEventFormResponse,
  resolveEventFormResponses,
  type EventFormResponse,
  type EventFormResponseInput,
  type EventFormResponseSource,
} from "./response-attribution";
