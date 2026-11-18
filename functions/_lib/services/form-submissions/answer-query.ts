import { formAnswerKeySchema } from "../../../../assets/shared/schemas/form-management";

/** One typed answer projection for filtering, sorting, and statistics. */
export const NORMALIZED_SUBMISSION_ANSWERS_CTE = `normalized_answers AS (
  SELECT m.id AS submission_id, COALESCE(ff.key, a.field_key) AS field_key,
         CASE WHEN json_valid(a.data_json) THEN a.data_json ELSE 'null' END AS data_json
  FROM response_candidates m
  JOIN form_submission_answers a ON m.source = 'submission' AND a.submission_id = m.source_id
  LEFT JOIN form_fields ff ON ff.id = a.field_id
  UNION ALL
  SELECT m.id AS submission_id, je.key AS field_key,
         CASE je.type
           WHEN 'array' THEN json(je.value)
           WHEN 'object' THEN json(je.value)
           WHEN 'true' THEN 'true'
           WHEN 'false' THEN 'false'
           WHEN 'null' THEN 'null'
           ELSE json_quote(je.value)
         END AS data_json
  FROM response_candidates m
  CROSS JOIN json_each(CASE WHEN json_valid(m.answers_json) THEN m.answers_json ELSE '{}' END) je
  WHERE m.source IN ('registration', 'proposal')
)`;

export function submissionAnswerSql(
  fieldKey: string,
  rowSource: "merged" | "response_candidates" = "merged",
): { sql: string; bindings: string[] } {
  return {
    sql: `SELECT a.data_json FROM normalized_answers a
          WHERE a.submission_id = ${rowSource}.id AND a.field_key = ? LIMIT 1`,
    bindings: [formAnswerKeySchema.parse(fieldKey)],
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
