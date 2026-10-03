import { MEMBERSHIP_APPLICATION_FORM_KEY } from "../../../../../assets/shared/schemas/membership-application-form";
import type { ApplicationImportMapping } from "../../../../../assets/shared/schemas/membership-application-import";
import { AppError } from "../../../errors";
import type { DatabaseLike } from "../../../types";
import { getGlobalFormByKey, prepareCreateFormSubmission, validateCustomAnswersAgainstForm } from "../../forms";
import { requireMembershipApplicationPolicyFields } from "../application-form";

/** Incomplete active mappings remain in reconciliation; live consent validation is unchanged. */
export async function prepareImportedApplicationForm(
  db: DatabaseLike,
  applicationId: string,
  mapping: ApplicationImportMapping,
  submittedAt: string,
) {
  const form = await getGlobalFormByKey(db, MEMBERSHIP_APPLICATION_FORM_KEY);
  if (!form)
    throw new AppError(
      409,
      "IMPORT_FORM_UNAVAILABLE",
      "Configure the membership application form before importing active applications",
    );
  requireMembershipApplicationPolicyFields(form.fields);
  const answers = await validateCustomAnswersAgainstForm(form, { customAnswers: mapping.answers, errorStatus: 422 });
  return prepareCreateFormSubmission(
    db,
    form,
    { submittedByUserId: mapping.applicantUserId, contextType: "membership", contextRef: applicationId },
    answers,
    submittedAt,
  );
}
