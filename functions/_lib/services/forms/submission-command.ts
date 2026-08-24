import { AppError } from "../../errors";
import { all } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import type { ActiveFormDefinition } from "./read";
import type { CustomAnswerValue } from "./validation";

interface SubmissionContext {
  submittedByUserId: string | null;
  contextType: "registration" | "proposal" | "membership" | "survey" | "feedback";
  contextRef: string | null;
  status?: "submitted" | "draft" | "withdrawn";
}

export interface PreparedFormSubmission {
  id: string;
  statements: StatementLike[];
}

interface ExistingContextSubmission {
  id: string;
}

function requirePlacement(form: ActiveFormDefinition) {
  if (!form.placement) {
    throw new AppError(503, "FORM_PLACEMENT_REQUIRED", "This form must be assigned to a response set before use");
  }
  return form.placement;
}

export function prepareFormSubmissionGuard(
  db: DatabaseLike,
  form: ActiveFormDefinition,
  submissionId: string | null = null,
): StatementLike {
  const placement = requirePlacement(form);
  return db
    .prepare(
      `INSERT INTO form_submission_guards
         (id, form_id, placement_id, submission_id, expected_form_updated_at,
          expected_placement_updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(uuid(), form.id, placement.id, submissionId, form.formUpdatedAt, placement.updatedAt);
}

/**
 * Produces the optimistic revision guard used by every placement-backed form
 * write. Legacy definitions without a placement remain readable/writable
 * during migration without inventing a response-set attribution.
 */
export function prepareFormRevisionGuard(
  db: DatabaseLike,
  form: ActiveFormDefinition | null,
  submissionId: string | null = null,
): StatementLike | null {
  return form?.placement ? prepareFormSubmissionGuard(db, form, submissionId) : null;
}

export function isFormSubmissionContextConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("FORM_SUBMISSION_CONTEXT_CHANGED");
}

export function formSubmissionContextChangedError(): AppError {
  return new AppError(409, "FORM_CHANGED", "The form changed while this response was being saved. Reload and retry.");
}

export function prepareFormAnswerMutations(
  db: DatabaseLike,
  form: ActiveFormDefinition,
  submissionId: string,
  answers: Readonly<Record<string, CustomAnswerValue | undefined>>,
  timestamp: string,
): StatementLike[] {
  const fieldsByKey = new Map(form.fields.map((field) => [field.key, field]));
  return Object.entries(answers).map(([key, value]) => {
    const field = fieldsByKey.get(key);
    if (!field) throw new AppError(422, "UNKNOWN_FORM_FIELD", `Unknown form field '${key}'`);
    if (value === undefined) {
      return db
        .prepare("DELETE FROM form_submission_answers WHERE submission_id = ? AND field_id = ?")
        .bind(submissionId, field.id);
    }
    return db
      .prepare(
        `INSERT INTO form_submission_answers
           (id, submission_id, field_id, field_key, data_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(submission_id, field_id) WHERE field_id IS NOT NULL
         DO UPDATE SET field_key = excluded.field_key, data_json = excluded.data_json`,
      )
      .bind(uuid(), submissionId, field.id, field.key, JSON.stringify(value), timestamp);
  });
}

export function prepareCreateFormSubmission(
  db: DatabaseLike,
  form: ActiveFormDefinition,
  context: SubmissionContext,
  answers: Readonly<Record<string, CustomAnswerValue>>,
  timestamp: string,
): PreparedFormSubmission {
  const id = uuid();
  const placement = form.placement;
  const insert = db
    .prepare(
      `INSERT INTO form_submissions
         (id, form_id, placement_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      form.id,
      placement?.id ?? null,
      context.submittedByUserId,
      context.contextType,
      context.contextRef,
      context.status ?? "submitted",
      timestamp,
    );
  return {
    id,
    statements: [
      ...(placement ? [prepareFormSubmissionGuard(db, form)] : []),
      insert,
      ...prepareFormAnswerMutations(db, form, id, answers, timestamp),
    ],
  };
}

export function prepareUpdateFormSubmission(
  db: DatabaseLike,
  form: ActiveFormDefinition,
  submissionId: string,
  answers: Readonly<Record<string, CustomAnswerValue | undefined>>,
  timestamp: string,
): StatementLike[] {
  const placement = form.placement;
  if (!placement) {
    return prepareFormAnswerMutations(db, form, submissionId, answers, timestamp);
  }
  return [
    prepareFormSubmissionGuard(db, form, submissionId),
    db
      .prepare(
        `UPDATE form_submissions
         SET placement_id = ?
         WHERE id = ? AND form_id = ? AND (placement_id IS NULL OR placement_id = ?)`,
      )
      .bind(placement.id, submissionId, form.id, placement.id),
    ...prepareFormAnswerMutations(db, form, submissionId, answers, timestamp),
  ];
}

/**
 * Replaces the active-field answer set for one domain aggregate. Registration,
 * proposal, and membership writers reuse this command so stable field IDs are
 * canonical while their existing JSON columns remain compatibility projections.
 */
export async function prepareReplaceContextFormSubmission(
  db: DatabaseLike,
  form: ActiveFormDefinition,
  context: SubmissionContext & { contextRef: string },
  answers: Readonly<Record<string, CustomAnswerValue>>,
  timestamp: string,
): Promise<PreparedFormSubmission> {
  const matches = await all<ExistingContextSubmission>(
    db,
    `SELECT id
     FROM form_submissions
     WHERE form_id = ? AND context_type = ? AND context_ref = ?
     ORDER BY submitted_at ASC, id ASC
     LIMIT 2`,
    [form.id, context.contextType, context.contextRef],
  );
  if (matches.length > 1) {
    throw new AppError(409, "FORM_SUBMISSION_AMBIGUOUS", "Multiple form submissions exist for this response");
  }
  const existing = matches[0];
  if (!existing) return prepareCreateFormSubmission(db, form, context, answers, timestamp);

  const replacements = Object.fromEntries(form.fields.map((field) => [field.key, answers[field.key]]));
  return {
    id: existing.id,
    statements: prepareUpdateFormSubmission(db, form, existing.id, replacements, timestamp),
  };
}
