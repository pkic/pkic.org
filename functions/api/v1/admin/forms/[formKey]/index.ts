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
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { AppError } from "../../../../../_lib/errors";
import {
  getManagedFormWithFields,
  mapManagedFormFields,
  removeManagedForm,
  requireLegacyAdminFormMutationBoundary,
  updateManagedForm,
} from "../../../../../_lib/services/forms";
import {
  adminFormDeleteRouteSchema,
  adminFormGetRouteSchema,
  adminFormPatchRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { adminFormUpdateResponseSchema } from "../../../../../../assets/shared/schemas/admin-forms";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

async function requireManagedForm(db: ReturnType<typeof requestDb>, formKey: string) {
  const result = await getManagedFormWithFields(db, formKey);
  if (!result) throw new AppError(404, "FORM_NOT_FOUND", `Form '${formKey}' not found`);
  return result;
}

export const AdminFormsFormKeyGet = openApiRoute(adminFormGetRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const { form, fields } = await requireManagedForm(requestDb(c), data.params.formKey);
  return json({ form, fields: mapManagedFormFields(fields) });
});

export const AdminFormsFormKeyPatch = openApiRoute(adminFormPatchRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = data.body;
  const { form } = await requireManagedForm(requestDb(c), data.params.formKey);
  await requireLegacyAdminFormMutationBoundary(requestDb(c), form);
  await updateManagedForm(requestDb(c), admin.id, form, body);

  const updated = await requireManagedForm(requestDb(c), data.params.formKey);
  return json(
    adminFormUpdateResponseSchema.parse({
      success: true,
      form: updated.form,
      fields: mapManagedFormFields(updated.fields),
    }),
  );
});

export const AdminFormsFormKeyDelete = openApiRoute(adminFormDeleteRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const { form } = await requireManagedForm(requestDb(c), data.params.formKey);
  await requireLegacyAdminFormMutationBoundary(requestDb(c), form);

  const action = await removeManagedForm(requestDb(c), admin.id, form);
  return json({
    success: true,
    action,
    ...(action === "archived" ? { message: "Form archived — submissions preserved." } : {}),
  });
});
