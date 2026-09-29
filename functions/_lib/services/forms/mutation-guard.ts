import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";

export function prepareFormMutationGuard(
  db: DatabaseLike,
  formId: string,
  expectedUpdatedAt: string,
  newUpdatedAt: string,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO form_mutation_guards (id, form_id, expected_updated_at, new_updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(uuid(), formId, expectedUpdatedAt, newUpdatedAt);
}

export function prepareFormDeletionGuard(db: DatabaseLike, formId: string): StatementLike {
  return db.prepare("INSERT INTO form_deletion_guards (id, form_id) VALUES (?, ?)").bind(uuid(), formId);
}

export function isFormMutationConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("FORM_CHANGED");
}

export function isFormDeletionEvidenceConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("FORM_HAS_RESPONSE_EVIDENCE");
}

export function formChangedError(): AppError {
  return new AppError(409, "FORM_CHANGED", "The form changed while this update was processed. Reload and retry.");
}
