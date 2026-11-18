import { parseAnswerSort, type FormSubmissionsExportQuery } from "../../../../assets/shared/schemas/form-management";
import { encodeBoundedCsv } from "../../csv";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { formatCustomAnswerValue } from "../../utils/custom-answer-display";
import { writeAuditLog } from "../audit";
import { type ManagedFormWithFields, mapManagedFormFields, resolveFormFieldOptionCatalogs } from "../forms/read";
import { countSubmissionPopulation, resolveFormSubmissionPopulation } from "./population-query";
import { readFormSubmissionsPage } from "./submission-page";

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
  const selectedFields = definition.fields.filter((field) => !params.field || field.key === params.field);
  if (params.field && !selectedFields.length)
    throw new AppError(400, "UNKNOWN_EXPORT_FIELD", "The selected answer field does not exist");
  const columns = params.columns ?? ["submitter", ...selectedFields.map((field) => `answer:${field.key}`)];
  const fieldByKey = new Map(selectedFields.map((field) => [field.key, field]));
  for (const column of columns) {
    const answer = parseAnswerSort(column);
    if (answer && !fieldByKey.has(answer.key))
      throw new AppError(400, "UNKNOWN_EXPORT_FIELD", "The selected answer field does not exist");
  }
  const answerKeys = columns.flatMap((column) => {
    const answer = parseAnswerSort(column);
    return answer ? [answer.key] : [];
  });
  const readParams = { ...params, formKey: definition.form.key, offset: 0, limit: limits.maxRows + 1 };
  const population = await resolveFormSubmissionPopulation(db, readParams);
  const count = countSubmissionPopulation(population);
  const total = await db
    .prepare(count.sql)
    .bind(...count.bindings)
    .first<{ total: number }>();
  if (Number(total?.total ?? 0) > limits.maxRows) {
    throw new AppError(413, "CSV_EXPORT_ROW_LIMIT_EXCEEDED", `CSV export is limited to ${limits.maxRows} records`);
  }
  const result = await readFormSubmissionsPage(db, population, readParams, answerKeys);
  if (result.total > limits.maxRows) {
    throw new AppError(413, "CSV_EXPORT_ROW_LIMIT_EXCEEDED", `CSV export is limited to ${limits.maxRows} records`);
  }
  const exportedFields = selectedFields.filter((field) => answerKeys.includes(field.key));
  const catalogs = await resolveFormFieldOptionCatalogs(db, exportedFields, { includeInactive: true });
  const fields = new Map(mapManagedFormFields(exportedFields, catalogs).map((field) => [field.key, field]));
  const headers = columns.map((column) => {
    const answer = parseAnswerSort(column);
    return answer
      ? fields.get(answer.key)!.label
      : column === "submitter"
        ? "Name"
        : column === "status"
          ? "Status"
          : "Submitted";
  });
  const csv = encodeBoundedCsv(
    [
      headers,
      ...result.submissions.map((submission) =>
        columns.map((column) => {
          const answer = parseAnswerSort(column);
          if (answer) return formatCustomAnswerValue(submission.answers[answer.key], fields.get(answer.key));
          if (column === "status") return submission.status;
          if (column === "submitted_at") return submission.submittedAt;
          return [submission.submitter?.firstName, submission.submitter?.lastName].filter(Boolean).join(" ");
        }),
      ),
    ],
    limits.maxBytes,
  );
  await writeAuditLog(db, "admin", params.actorUserId, "event_form_responses_export", "event", params.eventId, {
    formKey: definition.form.key,
    recordCount: result.submissions.length,
  });
  return csv;
}
