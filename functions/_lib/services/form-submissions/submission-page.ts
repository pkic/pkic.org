import { nativeAnswerJson, selectedSubmissionAnswersSql } from "./answer-query";
import { resolveAnswerSortOptions, submissionAnswerSortSql, type AnswerSortOption } from "./answer-sort";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";
import { buildOffsetPageSql, queryPage, type OffsetPageQuery } from "../../db/pagination";
import { all } from "../../db/queries";
import { resolveOrderBy } from "../../db/sort";
import { parseJsonSafe } from "../../utils/json";
import {
  formSubmissionSchema,
  parseAnswerSort,
  FORM_SUBMISSIONS_SORT_COLUMNS,
} from "../../../../assets/shared/schemas/form-management";
import type { DatabaseLike } from "../../types";
import type { FieldRow, SubmissionPayload, ListFormSubmissionsParams, ListFormSubmissionsResult } from "./types";
import {
  MERGED_SUBMISSION_BASE_COLUMNS,
  MERGED_SUBMISSION_COLUMNS,
  resolveFormSubmissionPopulation,
  selectFromSubmissionPopulation,
  type FormSubmissionPopulation,
  type MergedSubmissionRow,
} from "./population-query";

interface AnswerRow {
  submission_id: string;
  field_key: string;
  data_json: string | null;
}

function submitterFromRow(row: MergedSubmissionRow): SubmissionPayload["submitter"] {
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
  answerKeys?: string[],
): Promise<SubmissionPayload[]> {
  const submissionIds =
    answerKeys === undefined ? rows.filter((row) => row.source === "submission").map((row) => row.source_id) : [];
  const submissionFilter = buildD1JsonMembershipFilter("a.submission_id", submissionIds);
  const answerRows = submissionIds.length
    ? await all<AnswerRow>(
        db,
        `SELECT a.submission_id, COALESCE(ff.key, a.field_key) AS field_key, ${nativeAnswerJson("a.data_json")} AS data_json
         FROM form_submission_answers a
         LEFT JOIN form_fields ff ON ff.id = a.field_id
         WHERE ${submissionFilter.sql}
         ORDER BY a.submission_id, COALESCE(ff.key, a.field_key)`,
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
      row.source === "submission" && answerKeys === undefined
        ? (answersBySubmission.get(row.source_id) ?? {})
        : parseJsonSafe<Record<string, unknown>>(row.answers_json, {}),
  }));
}

/** Build the canonical merged submission page/count pair for runtime and D1 plan regressions. */
export function buildFormSubmissionsPageQuery(
  population: FormSubmissionPopulation,
  params: Pick<ListFormSubmissionsParams, "sort" | "limit" | "offset" | "responseId">,
  options: AnswerSortOption[] = [],
  answerKeys?: string[],
): OffsetPageQuery {
  let orderBy = resolveOrderBy(
    params.sort,
    FORM_SUBMISSIONS_SORT_COLUMNS,
    "ORDER BY submitted_at DESC",
    "source ASC, source_id ASC",
  );
  const parsedSort = parseAnswerSort(params.sort);
  const answerSort = parsedSort ? submissionAnswerSortSql(parsedSort.key, options) : null;
  if (answerSort) {
    orderBy = `ORDER BY answer_sort IS NULL ASC, answer_sort ${parsedSort?.desc ? "DESC" : "ASC"}, source ASC, source_id ASC`;
  }
  const selectedAnswers = answerKeys ? selectedSubmissionAnswersSql(answerKeys) : null;
  const projection = selectedAnswers
    ? `${MERGED_SUBMISSION_BASE_COLUMNS}, ${selectedAnswers.sql} AS answers_json`
    : MERGED_SUBMISSION_COLUMNS;
  const pageQuery = selectFromSubmissionPopulation(
    population,
    `SELECT ${projection}${answerSort ? `, ${answerSort.sql} AS answer_sort` : ""} FROM merged${params.responseId ? " WHERE id = ?" : ""}`,
    [
      ...(selectedAnswers?.bindings ?? []),
      ...(answerSort?.bindings ?? []),
      ...(params.responseId ? [params.responseId] : []),
    ],
  );
  return {
    ...pageQuery,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  };
}

/** `fields` lets a caller that already loaded the form definition skip rereading the sorted field. */
export async function listFormSubmissions(
  db: DatabaseLike,
  params: ListFormSubmissionsParams,
  fields?: readonly FieldRow[],
): Promise<ListFormSubmissionsResult> {
  const population = await resolveFormSubmissionPopulation(db, params);
  const options = await resolveAnswerSortOptions(db, population.form.id, params.sort, fields);
  const page = await queryPage<MergedSubmissionRow>(db, buildFormSubmissionsPageQuery(population, params, options));
  const submissions = page.rows.length
    ? (await attachSubmissionAnswers(db, page.rows)).map((submission) => formSubmissionSchema.parse(submission))
    : [];

  return {
    form: {
      id: population.form.id,
      key: population.form.key,
      title: population.form.title,
      purpose: population.form.purpose,
      placement: population.placement,
    },
    total: page.total,
    offset: params.offset,
    limit: params.limit,
    submissions,
  };
}

/**
 * Reads every matching row, with its selected answers, in one statement so an
 * export is a consistent snapshot. The caller checks the population count first.
 */
export async function readFormSubmissionSnapshot(
  db: DatabaseLike,
  population: FormSubmissionPopulation,
  params: Pick<ListFormSubmissionsParams, "sort" | "limit">,
  answerKeys: string[],
  sortOptions: AnswerSortOption[],
): Promise<SubmissionPayload[]> {
  const page = buildOffsetPageSql(
    buildFormSubmissionsPageQuery(population, { ...params, offset: 0 }, sortOptions, answerKeys),
  );
  const rows = await all<MergedSubmissionRow>(db, page.pageSql, [...page.bindings, params.limit, 0]);
  return (await attachSubmissionAnswers(db, rows, answerKeys)).map((submission) =>
    formSubmissionSchema.parse(submission),
  );
}
