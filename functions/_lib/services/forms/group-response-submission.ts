import type { GroupFormSubmissionInput } from "../../../../assets/shared/schemas/group-forms";
import { AppError } from "../../errors";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import {
  canViewerAccessGroupResource,
  prepareMemberGroupResourceAuthorizationGuard,
  type GroupResourceViewer,
} from "../resource-grants";
import {
  formSubmissionContextChangedError,
  isFormSubmissionContextConflict,
  prepareCreateFormSubmission,
} from "./submission-command";
import { getFormDefinitionByPlacement } from "./read";
import { validateCustomAnswersAgainstForm } from "./validation";

export async function submitGroupFormResponse(
  db: DatabaseLike,
  viewer: GroupResourceViewer,
  groupId: string,
  placementId: string,
  input: GroupFormSubmissionInput,
): Promise<string> {
  const canView = await canViewerAccessGroupResource(
    db,
    viewer,
    groupId,
    "formPlacement",
    placementId,
    "view_definition",
  );
  if (!canView) throw new AppError(404, "FORM_NOT_FOUND", "The form is not available through this group");
  const canSubmit = await canViewerAccessGroupResource(db, viewer, groupId, "formPlacement", placementId, "submit");
  if (!canSubmit) throw new AppError(403, "FORM_SUBMIT_REQUIRED", "The submit capability is required");

  const form = await getFormDefinitionByPlacement(db, placementId, { acceptingResponses: true });
  if (!form) throw new AppError(404, "FORM_NOT_ACCEPTING_RESPONSES", "The form is not accepting responses");
  if (form.purpose !== "survey" && form.purpose !== "feedback") {
    throw new AppError(
      403,
      "FORM_WORKFLOW_REQUIRED",
      "Registration, proposal, and application forms must use their dedicated workflow",
    );
  }

  const answers = validateCustomAnswersAgainstForm(form, {
    customAnswers: input.answers,
    errorStatus: 422,
  });
  const at = nowIso();
  const prepared = prepareCreateFormSubmission(
    db,
    form,
    {
      submittedByUserId: viewer.userId,
      contextType: form.purpose,
      contextRef: groupId,
    },
    answers,
    at,
  );
  try {
    await db.batch([
      prepareMemberGroupResourceAuthorizationGuard(db, viewer.userId, groupId, "formPlacement", placementId, "submit"),
      ...prepared.statements,
      prepareScopedAuditLog(
        db,
        { type: "group", id: groupId },
        "member",
        viewer.userId,
        "group_form_response_submitted",
        "form_submission",
        prepared.id,
        { placementId, formId: form.id },
        at,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "FORM_SUBMISSION_AUTHORIZATION_CHANGED",
        "Form submission access changed while the response was being saved",
      );
    }
    if (isFormSubmissionContextConflict(error)) throw formSubmissionContextChangedError();
    throw error;
  }
  return prepared.id;
}
