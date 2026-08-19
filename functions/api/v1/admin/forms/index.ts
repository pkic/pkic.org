/**
 * GET  /api/v1/admin/forms
 *   Lists all forms across scopes.
 *
 * POST /api/v1/admin/forms
 *   Creates a global form not linked to a specific event.
 */
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { run } from "../../../../_lib/db/queries";
import { listAdminForms } from "../../../../_lib/services/forms";
import { nowIso } from "../../../../_lib/utils/time";
import { uuid } from "../../../../_lib/utils/ids";
import { stringifyJson } from "../../../../_lib/utils/json";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { adminFormCreateSchema } from "../../../../../assets/shared/schemas/api";
import { adminFormsListRouteSchema } from "../../../../../assets/shared/schemas/route-contracts";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const AdminFormsList = openApiRoute(adminFormsListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const { limit = 200, offset = 0 } = data.query;
  const { forms, total } = await listAdminForms(requestDb(c), { limit, offset });

  return json({ forms, page: buildPageInfo(limit, offset, total, forms.length) });
});

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminFormCreateSchema);
  const now = nowIso();
  const formId = uuid();

  await run(
    requestDb(c),
    `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
     VALUES (?, ?, 'global', NULL, ?, ?, ?, ?, ?, ?)`,
    [formId, body.key, body.purpose, body.status, body.title, body.description ?? null, now, now],
  );

  for (const field of body.fields) {
    await run(
      requestDb(c),
      `INSERT INTO form_fields (id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        formId,
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

  await writeAuditLog(requestDb(c), "admin", admin.id, "global_form_created", "form", formId, {
    key: body.key,
    purpose: body.purpose,
  });

  return json({ success: true, formId, key: body.key }, 201);
}
