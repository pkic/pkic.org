import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { createTemplateVersion } from "../../../../../_lib/email/templates";
import { queryPage } from "../../../../../_lib/db/pagination";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../../../assets/shared/schemas/pagination";
import { adminEmailTemplateVersionSchema } from "../../../../../../assets/shared/schemas/api";
import { emailTemplateVersionsListRouteSchema } from "../../../../../../assets/shared/schemas/admin-email-templates";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

export const EmailTemplateVersionsList = openApiRoute(
  emailTemplateVersionsListRouteSchema,
  async (c: AdminContext, data) => {
    await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

    const key = c.req.param("key");
    const { limit = 50, offset = 0 } = data.query;

    const { rows: versions, total } = await queryPage(
      requestDb(c),
      {
        sql: `SELECT * FROM email_template_versions
         WHERE template_key = ?
         ORDER BY version DESC
         LIMIT ? OFFSET ?`,
        bindings: [key, limit, offset],
      },
      {
        sql: `SELECT COUNT(*) AS total FROM email_template_versions WHERE template_key = ?`,
        bindings: [key],
      },
    );

    return json({ versions, page: buildPageInfo(limit, offset, total, versions.length) });
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
