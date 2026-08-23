import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  adminEmailTemplateVersionCreateResponseSchema,
  adminEmailTemplateVersionSchema,
  emailTemplateVersionsListRouteSchema,
} from "../../../../../../assets/shared/schemas/admin-email-templates";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import {
  createAdminEmailTemplateVersion,
  listAdminEmailTemplateVersions,
} from "../../../../../_lib/services/admin-email-templates";

export const EmailTemplateVersionsList = openApiRoute(
  emailTemplateVersionsListRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

    return json(await listAdminEmailTemplateVersions(requestDb(c), c.req.param("key"), data.query));
  },
);

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEmailTemplateVersionSchema);

  const version = await createAdminEmailTemplateVersion(requestDb(c), admin, {
    templateKey: c.req.param("key"),
    content: body.content,
    subjectTemplate: body.subjectTemplate,
    contentType: body.contentType,
    messageType: body.messageType,
  });

  return json(adminEmailTemplateVersionCreateResponseSchema.parse({ success: true, version }));
}
