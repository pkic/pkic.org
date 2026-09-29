import { formSubmissionStatsRouteSchema } from "../../../../../assets/shared/schemas/route-contracts-forms";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import { getInstallationFormSubmissionStats } from "../../../../_lib/services/form-submissions";

export const FormsFormKeySubmissionStatsGet = openApiRoute(
  formSubmissionStatsRouteSchema,
  async (c: AdminContext, data) => {
    const actor = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
    requirePermission(actor, "forms:read");
    return json(
      await getInstallationFormSubmissionStats(requestDb(c), {
        formKey: data.params.formKey,
        ...data.query,
      }),
    );
  },
);
