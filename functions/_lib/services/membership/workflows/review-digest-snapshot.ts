import { MEMBERSHIP_APPLICATION_FORM_KEY } from "../../../../../assets/shared/schemas/membership-application-form";
import { compileSimpleTemplate } from "../../../email/render";
import { emailPlainText, resolveEmailTemplateData } from "../../../email/plain-text";
import { resolveTemplates } from "../../../email/templates";
import type { DatabaseLike } from "../../../types";
import { formatCustomAnswerValue } from "../../../utils/custom-answer-display";
import { getManagedFormWithFields, mapManagedFormFields, resolveFormFieldOptionCatalogs } from "../../forms";
import { getApplicationAnswers, type MemberApplicationRow } from "../applications/queries";
import { requireMembershipCategory } from "../categories";

/** Snapshot the complete application with configured labels and editable email fragments. */
export async function membershipReviewDigestSnapshot(
  db: DatabaseLike,
  application: MemberApplicationRow,
  reviewUrl: string,
  objections: Array<{ body: string; author: string | null }>,
) {
  const keys = ["partial_membership_review_summary", "partial_membership_review_details"];
  const [templates, form, answers, category] = await Promise.all([
    resolveTemplates(db, keys),
    getManagedFormWithFields(db, MEMBERSHIP_APPLICATION_FORM_KEY),
    getApplicationAnswers(db, application.form_submission_id),
    requireMembershipCategory(db, application.membership_category),
  ]);
  const fieldRows = form?.fields ?? [];
  const fields = mapManagedFormFields(fieldRows, await resolveFormFieldOptionCatalogs(db, fieldRows));
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const orderedKeys = [...new Set([...fields.map((field) => field.key), ...Object.keys(answers)])];
  const answerRows = orderedKeys.flatMap((key) => {
    const value = answers[key];
    if (value === undefined || value === null) return [];
    const field = fieldsByKey.get(key);
    return [
      { label: emailPlainText(field?.label ?? key), value: emailPlainText(formatCustomAnswerValue(value, field)) },
    ];
  });
  const data = resolveEmailTemplateData(
    {
      applicationName: emailPlainText(application.organization_name ?? application.applicant_name),
      applicantName: emailPlainText(application.applicant_name),
      applicantEmail: emailPlainText(application.applicant_email),
      organizationName: application.organization_name ? emailPlainText(application.organization_name) : null,
      categoryCode: emailPlainText(category.code),
      categoryLabel: emailPlainText(category.label),
      answerRows,
      objections: objections.map((objection) => ({
        author: objection.author ? emailPlainText(objection.author) : null,
        body: emailPlainText(objection.body),
      })),
      reviewUrl,
    },
    "markdown",
  );
  return {
    summary: `${compileSimpleTemplate(templates.get(keys[0])!.content, data, "markdown")}\n\n`,
    details: `${compileSimpleTemplate(templates.get(keys[1])!.content, data, "markdown")}\n\n`,
  };
}
