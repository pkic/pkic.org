import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { formSubmissionsResponseSchema } from "../../../../../assets/shared/schemas/form-management";
import { formSubmissionsListRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-forms";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { listInstallationFormSubmissions } from "../../../../_lib/services/form-submissions";

export const FormsFormKeySubmissionsGet = openApiRoute(
  formSubmissionsListRouteSchema,
  async (c: AdminContext, data) => {
    const actor = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(actor, "forms:read");
    const result = await listInstallationFormSubmissions(requestDb(c), {
      formKey: data.params.formKey,
      ...data.query,
    });
    return json(
      formSubmissionsResponseSchema.parse({
        form: result.form,
        page: buildPageInfo(result.limit, result.offset, result.total, result.submissions.length),
        submissions: result.submissions,
      }),
    );
  },
);
