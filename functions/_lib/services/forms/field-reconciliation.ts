import type { FormDefinitionUpdateInput } from "../../../../assets/shared/schemas/forms";
import { parseFormFieldOptions, type FormFieldOption } from "../../../../assets/shared/schemas/form-field-rules";
import { AppError } from "../../errors";
import { all } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { stringifyJson } from "../../utils/json";
import { uuid } from "../../utils/ids";

type FieldInput = NonNullable<FormDefinitionUpdateInput["fields"]>[number];

interface ExistingField {
  id: string;
  key: string;
  options_json: string | null;
  option_source: string | null;
  has_answers: number;
}

function reconcileOptions(field: FieldInput, existing: ExistingField | undefined): FormFieldOption[] | null {
  // A server-owned catalog is the canonical source of values. Never persist
  // the currently resolved options alongside it: doing so would turn a live
  // catalog into a stale snapshot on the next form edit.
  if (field.optionSource) return null;
  const requested = field.options ?? [];
  if (!existing?.has_answers) return requested.length > 0 ? requested : null;

  let persisted: unknown;
  try {
    persisted = existing.options_json ? JSON.parse(existing.options_json) : null;
  } catch {
    persisted = null;
  }
  const requestedValues = new Set(requested.map((option) => option.value));
  const retired = parseFormFieldOptions(persisted)
    .filter((option) => !requestedValues.has(option.value))
    .map((option) => ({ ...option, active: false }));
  const combined = [...requested, ...retired];
  return combined.length > 0 ? combined : null;
}

function fieldWriteStatement(
  db: DatabaseLike,
  formId: string,
  field: FieldInput,
  existing: ExistingField | undefined,
  now: string,
): StatementLike {
  const options = reconcileOptions(field, existing);
  if (!existing) {
    return db
      .prepare(
        `INSERT INTO form_fields
           (id, form_id, key, label, field_type, required, options_json, option_source, validation_json,
            sort_order, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        field.id ?? uuid(),
        formId,
        field.key,
        field.label,
        field.fieldType,
        field.required ? 1 : 0,
        options ? stringifyJson(options) : null,
        field.optionSource ?? null,
        field.validation ? stringifyJson(field.validation) : null,
        field.sortOrder,
        now,
        now,
      );
  }
  return db
    .prepare(
      `UPDATE form_fields
       SET key = ?, label = ?, field_type = ?, required = ?, options_json = ?, option_source = ?,
           validation_json = ?, sort_order = ?, updated_at = ?, archived_at = NULL
       WHERE id = ? AND form_id = ?`,
    )
    .bind(
      field.key,
      field.label,
      field.fieldType,
      field.required ? 1 : 0,
      options ? stringifyJson(options) : null,
      field.optionSource ?? null,
      field.validation ? stringifyJson(field.validation) : null,
      field.sortOrder,
      now,
      existing.id,
      formId,
    );
}

export async function prepareFieldReconciliation(
  db: DatabaseLike,
  formId: string,
  fields: NonNullable<FormDefinitionUpdateInput["fields"]>,
  now: string,
): Promise<StatementLike[]> {
  const existing = await all<ExistingField>(
    db,
    `SELECT ff.id, ff.key, ff.options_json, ff.option_source,
            (EXISTS(SELECT 1 FROM form_submission_answers a WHERE a.field_id = ff.id)
             OR EXISTS(
               SELECT 1
               FROM form_domain_response_evidence evidence,
                    json_each(
                      CASE WHEN json_valid(evidence.answers_json)
                           THEN evidence.answers_json ELSE '{}'
                      END
                    ) answer
               WHERE evidence.form_id = ff.form_id AND answer.key = ff.key
             )) AS has_answers
     FROM form_fields ff
     WHERE ff.form_id = ?`,
    [formId],
  );
  const byId = new Map(existing.map((field) => [field.id, field]));
  const byKey = new Map(existing.map((field) => [field.key, field]));
  const retained = new Set<string>();
  const statements: StatementLike[] = [];

  for (const field of fields) {
    const current = field.id ? byId.get(field.id) : byKey.get(field.key);
    if (field.id && !current) {
      throw new AppError(409, "FORM_FIELD_CHANGED", `Form field '${field.id}' no longer exists.`);
    }
    if (current) retained.add(current.id);
    statements.push(fieldWriteStatement(db, formId, field, current, now));
  }

  for (const current of existing) {
    if (retained.has(current.id)) continue;
    statements.push(
      current.has_answers
        ? db.prepare("UPDATE form_fields SET archived_at = ?, updated_at = ? WHERE id = ?").bind(now, now, current.id)
        : db.prepare("DELETE FROM form_fields WHERE id = ?").bind(current.id),
    );
  }
  return statements;
}
