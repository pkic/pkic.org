import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { createTemplateVersion } from "../../../../../_lib/email/templates";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { adminEmailTemplateVersionSchema } from "../../../../../../assets/shared/schemas/api";
import { emailTemplateVersionsListRouteSchema } from "../../../../../../assets/shared/schemas/admin-email-templates";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { listAdminEmailTemplateVersions } from "../../../../../_lib/services/admin-email-templates";

export const EmailTemplateVersionsList = openApiRoute(
  emailTemplateVersionsListRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

    return json(
      await listAdminEmailTemplateVersions(requestDb(c), c.req.param("key"), {
        ...data.query,
        limit: data.query.limit ?? 50,
        offset: data.query.offset ?? 0,
      }),
    );
  },
);

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminEmailTemplateVersionSchema);

  const version = await createTemplateVersion(requestDb(c), {
    templateKey: c.req.param("key"),
    content: body.content,
    subjectTemplate: body.subjectTemplate,
    contentType: body.contentType,
    messageType: body.messageType,
    createdByUserId: admin.id,
  });

  return json({ success: true, version });
}
