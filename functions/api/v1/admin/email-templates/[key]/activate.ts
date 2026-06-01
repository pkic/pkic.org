import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { handleError, json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { activateTemplateVersion } from "../../../../../_lib/email/templates";
import { adminEmailTemplateActivateSchema } from "../../../../../../assets/shared/schemas/api";
import { adminEmailTemplateActivateRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEmailTemplateActivateSchema);

  await activateTemplateVersion(requestDb(c), {
    templateKey: c.req.param("key"),
    version: body.version,
  });

  return json({ success: true });
}

export class AdminEmailTemplatesKeyActivatePost extends OpenAPIRoute {
  schema = adminEmailTemplateActivateRouteSchema;

  async handle(c: AdminContext) {
    try {
      return await onRequestPost(c);
    } catch (error) {
      return handleError(error);
    }
  }
}
