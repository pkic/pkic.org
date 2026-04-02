import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../../../_lib/validation";
import { handleError, json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { activateTemplateVersion } from "../../../../../_lib/email/templates";
import { adminEmailTemplateActivateSchema } from "../../../../../../assets/shared/schemas/api";

export async function onRequestPost(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw);
  const body = await parseJsonBody(c.req, adminEmailTemplateActivateSchema);

  await activateTemplateVersion(c.env.DB, {
    templateKey: c.req.param("key"),
    version: body.version,
  });

  return json({ success: true });
}

export class AdminEmailTemplatesKeyActivatePost extends OpenAPIRoute {
  schema = {};

  async handle(c: any) {
    try {
      return await onRequestPost(c as any);
    } catch (error) {
      return handleError(error);
    }
  }
}
