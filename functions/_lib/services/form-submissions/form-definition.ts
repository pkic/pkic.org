import { AppError } from "../../errors";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import type { FormRow } from "./types";

const FORM_SUBMISSION_FORM_COLUMNS = "id, key, title, purpose, scope_type, scope_ref";

export async function getFormByKey(db: DatabaseLike, formKey: string): Promise<FormRow> {
  const form = await first<FormRow>(db, `SELECT ${FORM_SUBMISSION_FORM_COLUMNS} FROM forms WHERE key = ?`, [formKey]);
  if (!form) throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found`);
  return form;
}
