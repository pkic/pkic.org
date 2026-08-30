import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import { formFieldOptionsSchema } from "../../../../assets/shared/schemas/form-field-rules";
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
 * Linking a form gives it all of that, plus what forms already guarantee:
 * stable field and option identities, labels that may be reworded after
 * responses exist, and options archived without invalidating an answer
 * already given. The vote keeps only what a vote owns — who may respond, the
 * window, and one response per represented Member.
 */
export interface ConsultationQuestionOption {
  value: string;
  label: string;
  active: boolean;
}

export interface ConsultationQuestion {
  fieldId: string;
  key: string;
  label: string;
  fieldType: string;
  required: boolean;
  /** Empty for free-text questions, which are recorded but never tallied. */
  options: ConsultationQuestionOption[];
}

export interface ConsultationForm {
  formId: string;
  title: string;
  questions: ConsultationQuestion[];
}

const FORM_QUERY = `SELECT id, title, status FROM forms WHERE id = ?`;
const FIELDS_QUERY = `
  SELECT id, key, label, field_type, required, options_json
    FROM form_fields
   WHERE form_id = ? AND archived_at IS NULL
   ORDER BY sort_order ASC, id ASC`;

export async function loadConsultationForm(db: DatabaseLike, vote: VoteRow): Promise<ConsultationForm | null> {
  if (!vote.question_form_id) return null;

  const form = await first<{ id: string; title: string; status: string }>(db, FORM_QUERY, [vote.question_form_id]);
  if (!form) throw new AppError(409, "VOTE_FORM_MISSING", "This consultation's form no longer exists");
  if (form.status === "archived") {
    throw new AppError(409, "VOTE_FORM_ARCHIVED", "This consultation's form has been archived");
  }

  const rows = await all<{
    id: string;
    key: string;
    label: string;
    field_type: string;
    required: number;
    options_json: string | null;
  }>(db, FIELDS_QUERY, [vote.question_form_id]);
  if (rows.length === 0) throw new AppError(409, "VOTE_FORM_HAS_NO_QUESTIONS", "This consultation asks nothing");

  return {
    formId: form.id,
    title: form.title,
    questions: rows.map((row) => {
      const parsed = formFieldOptionsSchema.safeParse(JSON.parse(row.options_json ?? "[]"));
      return {
        fieldId: row.id,
        key: row.key,
        label: row.label,
        fieldType: row.field_type,
        required: row.required === 1,
        options: parsed.success ? parsed.data : [],
      };
    }),
  };
}

/** The questions a tally can count: those offering a fixed set of choices. */
export function tallyableQuestions(form: ConsultationForm): ConsultationQuestion[] {
  return form.questions.filter(
    (question) =>
      question.options.length > 0 && (question.fieldType === "select" || question.fieldType === "multi_select"),
  );
}

/**
 * Whether an answer may be given now. Only active options may be chosen,
 * while an archived one stays valid on a response already recorded — the same
 * distinction forms draw between answering and having answered.
 */
export function questionAcceptsAnswer(question: ConsultationQuestion, answer: unknown): boolean {
  if (question.options.length === 0) return typeof answer === "string" || answer === null;
  const values = new Set(question.options.filter((option) => option.active).map((option) => option.value));
  if (question.fieldType === "multi_select") {
    return Array.isArray(answer) && answer.every((entry) => typeof entry === "string" && values.has(entry));
  }
  return typeof answer === "string" && values.has(answer);
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
  const rows = await all<{ submission_id: string; field_key: string; data_json: string | null }>(
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
