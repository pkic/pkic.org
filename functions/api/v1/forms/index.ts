import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { formCreateResponseSchema, formsListResponseSchema } from "../../../../assets/shared/schemas/form-management";
import { formCreateRouteSchema, formsListRouteSchema } from "../../../../assets/shared/schemas/route-contracts-forms";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { guardPermissionMutationDatabase, requirePermission } from "../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { AppError } from "../../../_lib/errors";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import { createManagedForm, listForms } from "../../../_lib/services/forms";
import { MEMBERSHIP_APPLICATION_FORM_KEY } from "../../../../assets/shared/schemas/membership-application-form";
import { rejectLegacyMembershipApplicationFormRoute } from "../../../_lib/services/membership/application-form";

export const FormsListGet = openApiRoute(formsListRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(actor, "forms:read");
  const result = await listForms(requestDb(c), {
    ...(data.query ?? {}),
    globalOnly: true,
    excludedFormKeys: [MEMBERSHIP_APPLICATION_FORM_KEY],
  });
  return json(
    formsListResponseSchema.parse({
      forms: result.forms,
      page: buildPageInfo(data.query!.limit, data.query!.offset, result.total, result.forms.length),
    }),
  );
});

export const FormsCreatePost = openApiRoute(formCreateRouteSchema, async (c: AdminContext, data) => {
  const actor = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(actor, "forms:write");
  rejectLegacyMembershipApplicationFormRoute(data.body!.key);
  const guardedDb = guardPermissionMutationDatabase(
    requestDb(c),
    actor,
    [{ permission: "forms:write" }],
    () =>
      new AppError(
        409,
        "FORM_AUTHORIZATION_CHANGED",
        "Form-management permission changed while the form was being created",
      ),
  );
  const form = await createManagedForm(guardedDb, actor.id, { type: "global", ref: null }, data.body!);
  return json(
    formCreateResponseSchema.parse({ success: true, formId: form.id, placementId: form.placementId, key: form.key }),
    201,
  );
});
