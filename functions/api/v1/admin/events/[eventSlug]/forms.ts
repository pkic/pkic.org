/**
 * GET  /api/v1/admin/events/:eventSlug/forms
 *   Lists all forms scoped to this event (by event_id as scope_ref),
 *   plus any global fallback forms, for all purposes.
 *
 * POST /api/v1/admin/events/:eventSlug/forms
 *   Creates a new form scoped to this event.
 */
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { all, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { uuid } from "../../../../../_lib/utils/ids";
import { stringifyJson } from "../../../../../_lib/utils/json";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import type { PagesContext } from "../../../../../_lib/types";
import { adminFormCreateSchema } from "../../../../../../assets/shared/schemas/api";

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
  field_count: number;
  submission_count: number;
}

export async function onRequestGet(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  const forms = await all<FormRow>(
    context.env.DB,
    `SELECT
       f.*,
       COUNT(DISTINCT ff.id) AS field_count,
       COUNT(DISTINCT fs.id) AS submission_count
     FROM forms f
     LEFT JOIN form_fields ff ON ff.form_id = f.id
     LEFT JOIN form_submissions fs ON fs.form_id = f.id
     WHERE (f.scope_type = 'event' AND f.scope_ref = ?)
        OR f.scope_type = 'global'
     GROUP BY f.id
     ORDER BY f.scope_type DESC, f.purpose ASC, f.updated_at DESC`,
    [event.id],
  );

  return json({ forms });
}

export async function onRequestPost(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminFormCreateSchema);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  const now = nowIso();
  const formId = uuid();

  await run(
    context.env.DB,
    `INSERT INTO forms (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
     VALUES (?, ?, 'event', ?, ?, ?, ?, ?, ?, ?)`,
    [
      formId,
      body.key,
      event.id,
      body.purpose,
      body.status,
      body.title,
      body.description ?? null,
      now,
      now,
    ],
  );

  for (const field of body.fields) {
    await run(
      context.env.DB,
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

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "event_form_created",
    "form",
    formId,
    { eventSlug: event.slug, key: body.key, purpose: body.purpose },
  );

  return json({ success: true, formId, key: body.key }, 201);
}

export async function onRequest(
  context: PagesContext<{ eventSlug: string }>,
): Promise<Response> {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
