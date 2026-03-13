/**
 * GET   /api/v1/admin/forms/:formKey
 *   Returns form metadata and all fields.
 *
 * PATCH /api/v1/admin/forms/:formKey
 *   Updates form metadata and optionally replaces all fields.
 *
 * DELETE /api/v1/admin/forms/:formKey
 *   Archives the form (sets status = 'archived'). Hard delete is not allowed
 *   when submissions exist.
 */
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { all, first, run } from "../../../../../_lib/db/queries";
import { parseJsonSafe, stringifyJson } from "../../../../../_lib/utils/json";
import { nowIso } from "../../../../../_lib/utils/time";
import { uuid } from "../../../../../_lib/utils/ids";
import { AppError } from "../../../../../_lib/errors";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import type { DatabaseLike, PagesContext } from "../../../../../_lib/types";
import { adminFormUpdateSchema } from "../../../../../../shared/schemas/api";

interface FormRow {
  id: string;
  key: string;
  scope_type: string;
  scope_ref: string | null;
  purpose: string;
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface FieldRow {
  id: string;
  key: string;
  label: string;
  field_type: string;
  required: number;
  options_json: string | null;
  validation_json: string | null;
  sort_order: number;
}

async function getFormWithFields(db: DatabaseLike, formKey: string): Promise<{ form: FormRow; fields: FieldRow[] }> {
  const form = await first<FormRow>(
    db,
    "SELECT * FROM forms WHERE key = ?",
    [formKey],
  );
  if (!form) throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found`);

  const fields = await all<FieldRow>(
    db,
    "SELECT * FROM form_fields WHERE form_id = ? ORDER BY sort_order ASC, key ASC",
    [form.id],
  );
  return { form, fields };
}

function mapFields(fields: FieldRow[]) {
  return fields.map((f) => ({
    id: f.id,
    key: f.key,
    label: f.label,
    fieldType: f.field_type,
    required: f.required === 1,
    options: parseJsonSafe(f.options_json, null),
    validation: parseJsonSafe(f.validation_json, null),
    sortOrder: f.sort_order,
  }));
}

export async function onRequestGet(
  context: PagesContext<{ formKey: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const { form, fields } = await getFormWithFields(context.env.DB, context.params.formKey);
  return json({ form, fields: mapFields(fields) });
}

export async function onRequestPatch(
  context: PagesContext<{ formKey: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminFormUpdateSchema);
  const { form } = await getFormWithFields(context.env.DB, context.params.formKey);
  const now = nowIso();

  if (body.title !== undefined || body.description !== undefined || body.status !== undefined) {
    await run(
      context.env.DB,
      `UPDATE forms
       SET title = COALESCE(?, title),
           description = IIF(? = 1, description, ?),
           status = COALESCE(?, status),
           updated_at = ?
       WHERE id = ?`,
      [
        body.title ?? null,
        body.description === undefined ? 1 : 0, body.description ?? null,
        body.status ?? null,
        now,
        form.id,
      ],
    );
  }

  if (body.fields !== undefined) {
    // Replace all fields: delete existing, insert new
    await run(context.env.DB, "DELETE FROM form_fields WHERE form_id = ?", [form.id]);
    for (const field of body.fields) {
      await run(
        context.env.DB,
        `INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuid(),
          form.id,
          field.key,
          field.label,
          field.fieldType,
          field.required ? 1 : 0,
          field.options ? stringifyJson(field.options) : null,
          field.validation ? stringifyJson(field.validation) : null,
          field.sortOrder,
          now,
        ],
      );
    }
    // Update form's updated_at
    await run(context.env.DB, "UPDATE forms SET updated_at = ? WHERE id = ?", [now, form.id]);
  }

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "form_updated",
    "form",
    form.id,
    { key: form.key, fieldsReplaced: body.fields !== undefined },
  );

  const updated = await getFormWithFields(context.env.DB, context.params.formKey);
  return json({ success: true, form: updated.form, fields: mapFields(updated.fields) });
}

export async function onRequestDelete(
  context: PagesContext<{ formKey: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const { form } = await getFormWithFields(context.env.DB, context.params.formKey);

  const subCount = await first<{ n: number }>(
    context.env.DB,
    "SELECT COUNT(*) AS n FROM form_submissions WHERE form_id = ?",
    [form.id],
  );

  if ((subCount?.n ?? 0) > 0) {
    // Archive rather than hard-delete to preserve submission history
    await run(
      context.env.DB,
      "UPDATE forms SET status = 'archived', updated_at = ? WHERE id = ?",
      [nowIso(), form.id],
    );
    await writeAuditLog(context.env.DB, "admin", admin.id, "form_archived", "form", form.id, { key: form.key });
    return json({ success: true, action: "archived", message: "Form archived — submissions preserved." });
  }

  await run(context.env.DB, "DELETE FROM form_fields WHERE form_id = ?", [form.id]);
  await run(context.env.DB, "DELETE FROM forms WHERE id = ?", [form.id]);
  await writeAuditLog(context.env.DB, "admin", admin.id, "form_deleted", "form", form.id, { key: form.key });
  return json({ success: true, action: "deleted" });
}

export async function onRequest(
  context: PagesContext<{ formKey: string }>,
): Promise<Response> {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  if (context.request.method === "DELETE") return onRequestDelete(context);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
