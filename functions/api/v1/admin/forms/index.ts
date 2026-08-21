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
import { createManagedForm, listAdminForms } from "../../../../_lib/services/forms";
import { adminFormCreateSchema } from "../../../../../assets/shared/schemas/admin-forms";
import { adminFormsListRouteSchema } from "../../../../../assets/shared/schemas/route-contracts";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const AdminFormsList = openApiRoute(adminFormsListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const { limit, offset, q, sort, purpose, status } = data.query;
  const { forms, total } = await listAdminForms(requestDb(c), { limit, offset, q, sort, purpose, status });

  return json({ forms, page: buildPageInfo(limit, offset, total, forms.length) });
});

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminFormCreateSchema);
  const form = await createManagedForm(requestDb(c), admin.id, { type: "global", ref: null }, body);
  return json({ success: true, formId: form.id, key: form.key }, 201);
}
