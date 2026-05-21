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
import { all, run } from "../../../../_lib/db/queries";
import { nowIso } from "../../../../_lib/utils/time";
import { uuid } from "../../../../_lib/utils/ids";
import { stringifyJson } from "../../../../_lib/utils/json";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { adminFormCreateSchema } from "../../../../../assets/shared/schemas/api";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

interface FormRow {
  id: string;
  key: string;
  scope_type: string;
  scope_ref: string | null;
  event_slug: string | null;
  event_name: string | null;
  purpose: string;
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  field_count: number;
  submission_count: number;
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const forms = await all<FormRow>(
    requestDb(c),
    `SELECT
       f.*,
       e.slug AS event_slug,
       e.name AS event_name,
       COUNT(DISTINCT ff.id) AS field_count,
       COUNT(DISTINCT fs.id)
         + CASE WHEN f.scope_type = 'event' AND f.purpose = 'event_registration' THEN (
             SELECT COUNT(*) FROM registrations r
             WHERE r.event_id = f.scope_ref AND r.custom_answers_json IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM form_submissions fs2
                 WHERE fs2.form_id = f.id AND fs2.context_type = 'registration' AND fs2.context_ref = r.id
               )
           ) ELSE 0 END
         + CASE WHEN f.scope_type = 'event' AND f.purpose = 'proposal_submission' THEN (
             SELECT COUNT(*) FROM session_proposals sp
             WHERE sp.event_id = f.scope_ref AND sp.details_json IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM form_submissions fs2
                 WHERE fs2.form_id = f.id AND fs2.context_type = 'proposal' AND fs2.context_ref = sp.id
               )
           ) ELSE 0 END AS submission_count
     FROM forms f
    LEFT JOIN events e ON e.id = f.scope_ref AND f.scope_type = 'event'
     LEFT JOIN form_fields ff ON ff.form_id = f.id
     LEFT JOIN form_submissions fs ON fs.form_id = f.id
     GROUP BY f.id
     ORDER BY f.scope_type ASC, f.purpose ASC, f.updated_at DESC`,
  );

  return json({ forms });
}

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

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "POST") return onRequestPost(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
