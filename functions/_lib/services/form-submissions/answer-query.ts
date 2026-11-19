import { formAnswerKeySchema } from "../../../../assets/shared/schemas/form-management";
import { buildD1JsonMembershipFilter } from "../../db/json-membership";

type AnswerRowSource = "merged" | "response_candidates";

/** Native answers stored as bare text stay one string value instead of disappearing. */
export function nativeAnswerJson(column: string): string {
  return `CASE WHEN json_valid(${column}) THEN ${column} ELSE json_quote(${column}) END`;
}

/** One legacy `json_each` entry as the same JSON value a native answer stores. */
function legacyAnswerJson(entry: string): string {
  return `CASE ${entry}.type
    WHEN 'array' THEN json(${entry}.value)
    WHEN 'object' THEN json(${entry}.value)
    WHEN 'true' THEN 'true'
    WHEN 'false' THEN 'false'
    WHEN 'null' THEN 'null'
    ELSE json_quote(${entry}.value) END`;
}

function legacyAnswersJson(row: string): string {
  return `CASE WHEN json_valid(${row}.answers_json) THEN ${row}.answers_json ELSE '{}' END`;
}

const NATIVE_FIELD_KEY = "COALESCE(ff.key, a.field_key)";

/** Every answer of the filtered population, for statistics that aggregate all fields. */
export const NORMALIZED_SUBMISSION_ANSWERS_CTE = `normalized_answers AS (
  SELECT m.id AS submission_id, ${NATIVE_FIELD_KEY} AS field_key, ${nativeAnswerJson("a.data_json")} AS data_json
  FROM merged m
  JOIN form_submission_answers a ON m.source = 'submission' AND a.submission_id = m.source_id
  LEFT JOIN form_fields ff ON ff.id = a.field_id
  UNION ALL
  SELECT m.id AS submission_id, je.key AS field_key, ${legacyAnswerJson("je")} AS data_json
  FROM merged m
  CROSS JOIN json_each(${legacyAnswersJson("m")}) je
  WHERE m.source IN ('registration', 'proposal')
)`;

/**
 * One row's answer as JSON. Native rows probe the indexed answer table by
 * submission; legacy rows read only their own JSON, so the cost stays per row.
 */
export function submissionAnswerSql(
  fieldKey: string,
  row: AnswerRowSource = "merged",
): { sql: string; bindings: string[] } {
  const key = formAnswerKeySchema.parse(fieldKey);
  return {
    sql: `CASE WHEN ${row}.source = 'submission' THEN (
      SELECT ${nativeAnswerJson("a.data_json")} FROM form_submission_answers a
      LEFT JOIN form_fields ff ON ff.id = a.field_id
      WHERE a.submission_id = ${row}.source_id AND ${NATIVE_FIELD_KEY} = ? LIMIT 1
    ) ELSE (
      SELECT ${legacyAnswerJson("je")} FROM json_each(${legacyAnswersJson(row)}) je
      WHERE je.key = ? LIMIT 1
    ) END`,
    bindings: [key, key],
  };
}

/** The selected answers of one row as a JSON object, read in the page statement itself. */
export function selectedSubmissionAnswersSql(
  answerKeys: readonly string[],
  row: AnswerRowSource = "merged",
): { sql: string; bindings: string[] } {
  const keys = answerKeys.map((key) => formAnswerKeySchema.parse(key));
  const nativeKeys = buildD1JsonMembershipFilter(NATIVE_FIELD_KEY, keys);
  const legacyKeys = buildD1JsonMembershipFilter("je.key", keys);
  return {
    sql: `CASE WHEN ${row}.source = 'submission' THEN (
      SELECT json_group_object(${NATIVE_FIELD_KEY}, json(${nativeAnswerJson("a.data_json")}))
      FROM form_submission_answers a
      LEFT JOIN form_fields ff ON ff.id = a.field_id
      WHERE a.submission_id = ${row}.source_id AND ${nativeKeys.sql}
    ) ELSE (
      SELECT json_group_object(je.key, json(${legacyAnswerJson("je")}))
      FROM json_each(${legacyAnswersJson(row)}) je
      WHERE ${legacyKeys.sql}
    ) END`,
    bindings: [...nativeKeys.bindings, ...legacyKeys.bindings],
  };
}

/** json_each treats scalars as one value and arrays as their selected members. */
export function submissionAnswerFilter(fieldKey?: string, value?: string) {
  if (!fieldKey || !value) return { sql: "", bindings: [] };
  const answer = submissionAnswerSql(fieldKey, "response_candidates");
  return {
    sql: `WHERE EXISTS (SELECT 1 FROM json_each(COALESCE((${answer.sql}), 'null')) selected
      WHERE CASE selected.type WHEN 'true' THEN 'true' WHEN 'false' THEN 'false'
        ELSE CAST(selected.value AS TEXT) END = ?)`,
    bindings: [...answer.bindings, value],
  };
}
