import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { queryPage } from "../../db/pagination";
import { all } from "../../db/queries";
import { resolveOrderBy } from "../../db/sort";
import { parseJsonSafe } from "../../utils/json";
import {
  adminFormSubmissionSchema,
  FORM_SUBMISSIONS_SORT_COLUMNS,
} from "../../../../assets/shared/schemas/admin-forms";
import type { DatabaseLike } from "../../types";
import type { AdminSubmissionPayload, ListFormSubmissionsParams, ListFormSubmissionsResult } from "./types";
import {
  MERGED_SUBMISSION_COLUMNS,
  resolveFormSubmissionPopulation,
  selectFromSubmissionPopulation,
  type MergedSubmissionRow,
} from "./population-query";

interface AnswerRow {
  submission_id: string;
  field_key: string;
  data_json: string | null;
}

function submitterFromRow(row: MergedSubmissionRow): AdminSubmissionPayload["submitter"] {
  if (!row.user_id) return null;
  return {
    id: row.user_id,
    email: row.user_email,
    firstName: row.user_first_name,
    lastName: row.user_last_name,
    organization: row.user_organization,
  };
}

/** Loads native form answers for only the already bounded page of rows. */
async function attachSubmissionAnswers(
  db: DatabaseLike,
  rows: MergedSubmissionRow[],
): Promise<AdminSubmissionPayload[]> {
  const submissionIds = rows.filter((row) => row.source === "submission").map((row) => row.source_id);
  const submissionFilter = buildD1JsonMembershipFilter("submission_id", submissionIds);
  const answerRows = submissionIds.length
    ? await all<AnswerRow>(
        db,
        `SELECT submission_id, field_key, data_json
         FROM form_submission_answers
         WHERE ${submissionFilter.sql}
         ORDER BY submission_id, field_key`,
        submissionFilter.bindings,
      )
    : [];

  const answersBySubmission = new Map<string, Record<string, unknown>>();
  for (const answer of answerRows) {
    const answers = answersBySubmission.get(answer.submission_id) ?? {};
    answers[answer.field_key] = parseJsonSafe(answer.data_json, null);
    answersBySubmission.set(answer.submission_id, answers);
  }

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    submittedAt: row.submitted_at,
    contextType: row.context_type,
    contextRef: row.context_ref,
    submitter: submitterFromRow(row),
    answers:
      row.source === "submission"
        ? (answersBySubmission.get(row.source_id) ?? {})
        : parseJsonSafe<Record<string, unknown>>(row.answers_json, {}),
  }));
}

export async function listFormSubmissions(
  db: DatabaseLike,
  params: ListFormSubmissionsParams,
): Promise<ListFormSubmissionsResult> {
  const population = await resolveFormSubmissionPopulation(db, params);
  const orderBy = resolveOrderBy(
    params.sort,
    FORM_SUBMISSIONS_SORT_COLUMNS,
    "ORDER BY submitted_at DESC",
    "source ASC, source_id ASC",
  );
  const pageQuery = selectFromSubmissionPopulation(population, `SELECT ${MERGED_SUBMISSION_COLUMNS} FROM merged`);
  const page = await queryPage<MergedSubmissionRow>(db, {
    ...pageQuery,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  const submissions = page.rows.length
    ? (await attachSubmissionAnswers(db, page.rows)).map((submission) => adminFormSubmissionSchema.parse(submission))
    : [];

  return {
    form: {
      id: population.form.id,
      key: population.form.key,
      title: population.form.title,
      purpose: population.form.purpose,
    },
    total: page.total,
    offset: params.offset,
    limit: params.limit,
    submissions,
  };
}
