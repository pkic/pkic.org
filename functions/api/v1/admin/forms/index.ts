/**
 * GET  /api/v1/admin/forms
 *   Lists all forms across scopes.
 *
 * POST /api/v1/admin/forms
 *   Creates a global form not linked to a specific event.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { createManagedForm, listAdminForms } from "../../../../_lib/services/forms";
import {
  adminFormCreateResponseSchema,
  adminFormsListResponseSchema,
} from "../../../../../assets/shared/schemas/admin-forms";
import {
  adminFormCreateRouteSchema,
  adminFormsListRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const AdminFormsList = openApiRoute(adminFormsListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const { forms, total } = await listAdminForms(requestDb(c), data.query);

  return json(
    adminFormsListResponseSchema.parse({
      forms,
      page: buildPageInfo(data.query.limit, data.query.offset, total, forms.length),
    }),
  );
});

export const AdminFormsCreate = openApiRoute(adminFormCreateRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const form = await createManagedForm(requestDb(c), admin.id, { type: "global", ref: null }, data.body);
  return json(
    adminFormCreateResponseSchema.parse({
      success: true,
      formId: form.id,
      placementId: form.placementId,
      key: form.key,
    }),
    201,
  );
});
