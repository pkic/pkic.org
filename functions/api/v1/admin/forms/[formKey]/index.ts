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
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { handleError, json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { all, first, run } from "../../../../../_lib/db/queries";
import { parseJsonSafe, stringifyJson } from "../../../../../_lib/utils/json";
import { nowIso } from "../../../../../_lib/utils/time";
import { uuid } from "../../../../../_lib/utils/ids";
import { AppError } from "../../../../../_lib/errors";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import type { DatabaseLike } from "../../../../../_lib/types";
import { adminFormUpdateSchema } from "../../../../../../assets/shared/schemas/api";

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

export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const { form, fields } = await getFormWithFields(c.env.DB, c.req.param("formKey"));
  return json({ form, fields: mapFields(fields) });
}

export async function onRequestPatch(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminFormUpdateSchema);
  const { form } = await getFormWithFields(c.env.DB, c.req.param("formKey"));
  const now = nowIso();

  if (body.title !== undefined || body.description !== undefined || body.status !== undefined) {
    await run(
      c.env.DB,
      `UPDATE forms
       SET title = COALESCE(?, title),
           description = IIF(? = 1, description, ?),
           status = COALESCE(?, status),
           updated_at = ?
       WHERE id = ?`,
      [
        body.title ?? null,
        body.description === undefined ? 1 : 0,
        body.description ?? null,
        body.status ?? null,
        now,
        form.id,
      ],
    );
  }

  if (body.fields !== undefined) {
    await run(c.env.DB, "DELETE FROM form_fields WHERE form_id = ?", [form.id]);
    for (const field of body.fields) {
      await run(
        c.env.DB,
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
    await run(c.env.DB, "UPDATE forms SET updated_at = ? WHERE id = ?", [now, form.id]);
  }

  await writeAuditLog(
    c.env.DB,
    "admin",
    admin.id,
    "form_updated",
    "form",
    form.id,
    { key: form.key, fieldsReplaced: body.fields !== undefined },
  );

  const updated = await getFormWithFields(c.env.DB, c.req.param("formKey"));
  return json({ success: true, form: updated.form, fields: mapFields(updated.fields) });
}

export async function onRequestDelete(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const { form } = await getFormWithFields(c.env.DB, c.req.param("formKey"));

  const subCount = await first<{ n: number }>(
    c.env.DB,
    "SELECT COUNT(*) AS n FROM form_submissions WHERE form_id = ?",
    [form.id],
  );

  if ((subCount?.n ?? 0) > 0) {
    await run(
      c.env.DB,
      "UPDATE forms SET status = 'archived', updated_at = ? WHERE id = ?",
      [nowIso(), form.id],
    );
    await writeAuditLog(c.env.DB, "admin", admin.id, "form_archived", "form", form.id, { key: form.key });
    return json({ success: true, action: "archived", message: "Form archived — submissions preserved." });
  }

  await run(c.env.DB, "DELETE FROM form_fields WHERE form_id = ?", [form.id]);
  await run(c.env.DB, "DELETE FROM forms WHERE id = ?", [form.id]);
  await writeAuditLog(c.env.DB, "admin", admin.id, "form_deleted", "form", form.id, { key: form.key });
  return json({ success: true, action: "deleted" });
}

export class AdminFormsFormKeyGet extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    try {
      return await onRequestGet(c as any);
    } catch (error) {
      return handleError(error);
    }
  }
}

export class AdminFormsFormKeyPatch extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    try {
      return await onRequestPatch(c as any);
    } catch (error) {
      return handleError(error);
    }
  }
}

export class AdminFormsFormKeyDelete extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    try {
      return await onRequestDelete(c as any);
    } catch (error) {
      return handleError(error);
    }
  }
}
