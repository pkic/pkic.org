import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { activateTemplateVersion } from "../../../../../_lib/email/templates";
import { adminEmailTemplateActivateRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const AdminEmailTemplatesKeyActivatePost = openApiRoute(
  adminEmailTemplateActivateRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

    await activateTemplateVersion(requestDb(c), {
      templateKey: data.params.key,
      version: data.body.version,
    });

    return json({ success: true });
  },
);
