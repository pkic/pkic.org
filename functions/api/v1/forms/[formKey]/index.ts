import {
  formDeleteResponseSchema,
  formDetailResponseSchema,
  formUpdateResponseSchema,
} from "../../../../../assets/shared/schemas/form-management";
import {
  formDeleteRouteSchema,
  formGetRouteSchema,
  formPatchRouteSchema,
} from "../../../../../assets/shared/schemas/route-contracts-forms";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { guardPermissionMutationDatabase, requirePermission } from "../../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  getManagedFormWithFields,
  mapManagedFormFields,
  removeManagedForm,
  updateManagedForm,
} from "../../../../_lib/services/forms";
import { rejectLegacyMembershipApplicationFormRoute } from "../../../../_lib/services/membership/application-form";

async function requireForm(db: ReturnType<typeof requestDb>, key: string) {
  rejectLegacyMembershipApplicationFormRoute(key);
  const result = await getManagedFormWithFields(db, key);
  if (!result || result.form.scope_type !== "global") {
    throw new AppError(404, "FORM_NOT_FOUND", `Form '${key}' not found`);
  }
  return result;
}

function guardedFormsDatabase(c: AdminContext, actor: Awaited<ReturnType<typeof requireUserBackedAdminFromRequest>>) {
  return guardPermissionMutationDatabase(
    requestDb(c),
    actor,
    [{ permission: "forms:write" }],
    () =>
      new AppError(
        409,
        "FORM_AUTHORIZATION_CHANGED",
        "Form-management permission changed while the form was being saved",
      ),
  );
}

export const FormsGet = openApiRoute(formGetRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(actor, "forms:read");
  const result = await requireForm(requestDb(c), data.params.formKey);
  return json(formDetailResponseSchema.parse({ form: result.form, fields: mapManagedFormFields(result.fields) }));
});

export const FormsPatch = openApiRoute(formPatchRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(actor, "forms:write");
  const current = await requireForm(requestDb(c), data.params.formKey);
  await updateManagedForm(guardedFormsDatabase(c, actor), actor.id, current.form, data.body);
  const updated = await requireForm(requestDb(c), data.params.formKey);
  return json(
    formUpdateResponseSchema.parse({ success: true, form: updated.form, fields: mapManagedFormFields(updated.fields) }),
  );
});

export const FormsDelete = openApiRoute(formDeleteRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(actor, "forms:write");
  const current = await requireForm(requestDb(c), data.params.formKey);
  const action = await removeManagedForm(guardedFormsDatabase(c, actor), actor.id, current.form);
  return json(
    formDeleteResponseSchema.parse({
      action,
      ...(action === "archived" ? { message: "Form archived — submissions preserved." } : {}),
    }),
  );
});
