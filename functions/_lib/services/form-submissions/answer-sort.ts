import { parseAnswerSort } from "../../../../assets/shared/schemas/form-management";
import { parseFormFieldOptions } from "../../../../assets/shared/schemas/form-field-rules";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { parseFormFieldOptionSource, resolveFormFieldOptionCatalogs } from "../forms/read";
import { submissionAnswerSql } from "./answer-query";
import type { FieldRow } from "./types";

export async function resolveAnswerSortOptions(db: DatabaseLike, formId: string, sort?: string) {
  const answer = parseAnswerSort(sort);
  if (!answer) return [];
  const field = await db
    .prepare("SELECT id, key, options_json, option_source FROM form_fields WHERE form_id = ? AND key = ?")
    .bind(formId, answer.key)
    .first<FieldRow>();
  if (!field) return [];
  const source = parseFormFieldOptionSource(field.option_source);
  const catalogs = await resolveFormFieldOptionCatalogs(db, [field], { includeInactive: true });
  return source ? (catalogs[source] ?? []) : parseFormFieldOptions(parseJsonSafe(field.options_json, null));
}

/** Preserve numeric scalars; text and choices follow the displayed labels. */
export function submissionAnswerSortSql(key: string, options: { value: string; label: string }[]) {
  const answer = submissionAnswerSql(key);
  return {
    sql: `(SELECT CASE WHEN json_type(answer.data_json) IN ('integer', 'real')
      THEN json_extract(answer.data_json, '$')
      ELSE (SELECT LOWER(NULLIF(group_concat(COALESCE(
        (SELECT json_extract(option.value, '$.label') FROM json_each(?) option
         WHERE json_extract(option.value, '$.value') = CAST(selected.value AS TEXT) LIMIT 1),
        CASE selected.type WHEN 'true' THEN 'Yes' WHEN 'false' THEN 'No'
          ELSE CAST(selected.value AS TEXT) END), ', '), ''))
        FROM json_each(answer.data_json) selected) END
      FROM (${answer.sql}) answer)`,
    bindings: [JSON.stringify(options), ...answer.bindings],
  };
}
