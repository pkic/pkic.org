import { formAnswerKeySchema } from "../../../../assets/shared/schemas/form-management";

/** Read the same field from normalized submissions and legacy response JSON. */
export function submissionAnswerSql(fieldKey: string): { sql: string; bindings: string[] } {
  const key = formAnswerKeySchema.parse(fieldKey);
  return {
    sql: `CASE WHEN source = 'submission' THEN (
      SELECT CASE WHEN json_valid(a.data_json) THEN a.data_json ELSE 'null' END FROM form_submission_answers a
      LEFT JOIN form_fields ff ON ff.id = a.field_id
      WHERE a.submission_id = source_id AND COALESCE(ff.key, a.field_key) = ?
      LIMIT 1
    ) ELSE (
      SELECT CASE value.type
        WHEN 'array' THEN json(value.value)
        WHEN 'object' THEN json(value.value)
        ELSE json_quote(value.value) END
      FROM json_each(CASE WHEN json_valid(answers_json) THEN answers_json ELSE '{}' END) value
      WHERE value.key = ? LIMIT 1
    ) END`,
    bindings: [key, key],
  };
}

/** json_each treats scalars as one value and arrays as their selected members. */
export function submissionAnswerFilter(fieldKey?: string, value?: string) {
  if (!fieldKey || !value) return { sql: "", bindings: [] };
  const answer = submissionAnswerSql(fieldKey);
  return {
    sql: `WHERE EXISTS (SELECT 1 FROM json_each(COALESCE((${answer.sql}), 'null')) selected
      WHERE CAST(selected.value AS TEXT) = ?)`,
    bindings: [...answer.bindings, value],
  };
}
