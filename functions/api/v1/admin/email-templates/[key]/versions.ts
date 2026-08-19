import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { createTemplateVersion } from "../../../../../_lib/email/templates";
import { all, first } from "../../../../../_lib/db/queries";
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

    const [versions, totalRow] = await Promise.all([
      all(
        requestDb(c),
        `SELECT * FROM email_template_versions
         WHERE template_key = ?
         ORDER BY version DESC
         LIMIT ? OFFSET ?`,
        [key, limit, offset],
      ),
      first<{ total: number }>(
        requestDb(c),
        `SELECT COUNT(*) AS total FROM email_template_versions WHERE template_key = ?`,
        [key],
      ),
    ]);
    const total = Number(totalRow?.total ?? 0);

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
