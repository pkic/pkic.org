import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import { mapManagedFormFields, resolveFormFieldOptionCatalogs, type FormFieldRow } from "../forms/read";
import type { FormFieldDefinition } from "../../../../assets/shared/schemas/forms";
import type { DatabaseLike } from "../../types";
import type { VoteRow } from "./shared";

/**
 * A consultation's questions, borrowed from a form.
 *
 * Motions and elections are bylaw instruments with fixed shapes, so they keep
 * their own vocabularies. A consultation has no such constraint and was stuck
 * with the motion's three answers, which meant it could not ask what a
 * consultation is actually for: would you support this, and how would you
 * want it done — two questions and one opinion.
 *
 * The fields are projected through the same reader every other form uses, so
 * the portal renders a consultation with the ordinary form components rather
 * than a second implementation that would drift from them.
 */
export interface ConsultationForm {
  id: string;
  title: string;
  description: string | null;
  fields: FormFieldDefinition[];
}

export async function loadConsultationForm(db: DatabaseLike, vote: VoteRow): Promise<ConsultationForm | null> {
  if (!vote.question_form_id) return null;

  const form = await first<{ id: string; title: string; description: string | null; status: string }>(
    db,
    `SELECT id, title, description, status FROM forms WHERE id = ?`,
    [vote.question_form_id],
  );
  if (!form) throw new AppError(409, "VOTE_FORM_MISSING", "This consultation's form no longer exists");
  if (form.status === "archived") {
    throw new AppError(409, "VOTE_FORM_ARCHIVED", "This consultation's form has been archived");
  }

  const rows = await all<FormFieldRow>(
    db,
    `SELECT id, form_id, key, label, field_type, required, options_json, option_source, validation_json,
            sort_order, updated_at, archived_at
       FROM form_fields
      WHERE form_id = ? AND archived_at IS NULL
      ORDER BY sort_order ASC, id ASC`,
    [vote.question_form_id],
  );
  if (rows.length === 0) throw new AppError(409, "VOTE_FORM_HAS_NO_QUESTIONS", "This consultation asks nothing");

  const catalogs = await resolveFormFieldOptionCatalogs(db, rows);
  return {
    id: form.id,
    title: form.title,
    description: form.description,
    fields: mapManagedFormFields(rows, catalogs),
  };
}

/** The questions a tally can count: those offering a fixed set of choices. */
export function tallyableQuestions(form: ConsultationForm): FormFieldDefinition[] {
  return form.fields.filter(
    (field) => (field.options?.length ?? 0) > 0 && (field.fieldType === "select" || field.fieldType === "multi_select"),
  );
}

/**
 * Every consultation response for one round, as a map of field key to answer.
 *
 * The answers live in `form_submission_answers` exactly as any other form
 * response does, so nothing here is a vote-specific storage format — the
 * consultation link table only says which represented Member each submission
 * speaks for.
 */
export async function consultationResponses(
  db: DatabaseLike,
  voteId: string,
  round: number,
): Promise<Array<Record<string, unknown>>> {
  const rows = await all<{ submission_id: string; field_key: string | null; data_json: string | null }>(
    db,
    `SELECT response.submission_id AS submission_id, answer.field_key AS field_key, answer.data_json AS data_json
       FROM vote_consultation_responses response
       LEFT JOIN form_submission_answers answer ON answer.submission_id = response.submission_id
      WHERE response.vote_id = ? AND response.round = ?`,
    [voteId, round],
  );

  const bySubmission = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const answers = bySubmission.get(row.submission_id) ?? {};
    if (row.field_key) {
      try {
        answers[row.field_key] = row.data_json === null ? null : JSON.parse(row.data_json);
      } catch {
        answers[row.field_key] = row.data_json;
      }
    }
    bySubmission.set(row.submission_id, answers);
  }
  return [...bySubmission.values()];
}
