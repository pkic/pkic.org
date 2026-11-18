import type { FormSubmissionsExportQuery } from "../../../../assets/shared/schemas/form-management";
import { encodeBoundedCsv } from "../../csv";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { formatCustomAnswerValue } from "../../utils/custom-answer-display";
import { writeAuditLog } from "../audit";
import { type ManagedFormWithFields, mapManagedFormFields, resolveFormFieldOptionCatalogs } from "../forms/read";
import { listFormSubmissions } from "./submission-page";

export async function exportEventFormResponses(
  db: DatabaseLike,
  params: FormSubmissionsExportQuery & {
    definition: ManagedFormWithFields;
    eventSlug: string;
    eventId: string;
    actorUserId: string;
  },
  limits: { maxRows: number; maxBytes: number },
): Promise<string> {
  const { definition } = params;
  const result = await listFormSubmissions(db, {
    ...params,
    formKey: definition.form.key,
    offset: 0,
    limit: limits.maxRows + 1,
  });
  if (result.total > limits.maxRows) {
    throw new AppError(413, "CSV_EXPORT_ROW_LIMIT_EXCEEDED", `CSV export is limited to ${limits.maxRows} records`);
  }
  const catalogs = await resolveFormFieldOptionCatalogs(db, definition.fields);
  const fields = mapManagedFormFields(definition.fields, catalogs).filter(
    (field) => !params.field || field.key === params.field,
  );
  if (params.field && !fields.length)
    throw new AppError(400, "UNKNOWN_EXPORT_FIELD", "The selected answer field does not exist");
  const csv = encodeBoundedCsv(
    [
      ["Name", ...fields.map((field) => field.label)],
      ...result.submissions.map((submission) => [
        [submission.submitter?.firstName, submission.submitter?.lastName].filter(Boolean).join(" "),
        ...fields.map((field) => formatCustomAnswerValue(submission.answers[field.key], field)),
      ]),
    ],
    limits.maxBytes,
  );
  await writeAuditLog(db, "admin", params.actorUserId, "event_form_responses_export", "event", params.eventId, {
    formKey: definition.form.key,
    recordCount: result.submissions.length,
  });
  return csv;
}
