import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { createTemplateVersion } from "../../../../../_lib/email/templates";
import { queryPage } from "../../../../../_lib/db/pagination";
import { buildD1TextSearchFilter } from "../../../../../_lib/db/search";
import { resolveMappedOrderBy } from "../../../../../_lib/db/sort";
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
    const { q, sort, limit = 50, offset = 0 } = data.query;
    const search = q
      ? buildD1TextSearchFilter(q, ["subject_template", "status", "content_type", "message_type"])
      : null;
    const searchSql = search ? `AND ${search.sql}` : "";
    const bindings = [key, ...(search?.bindings ?? [])];
    const orderBy = resolveMappedOrderBy(
      sort,
      {
        version: "version",
        status: "status COLLATE NOCASE",
        createdAt: "created_at",
      },
      "version DESC",
      "id ASC",
    );

    const { rows: versions, total } = await queryPage(
      requestDb(c),
      {
        sql: `SELECT
           id,
           template_key,
           version,
           subject_template,
           body,
           content_type,
           r2_object_key,
           checksum_sha256,
           status,
           created_by_user_id,
           created_at,
           message_type
         FROM email_template_versions
         WHERE template_key = ?
         ${searchSql}
         ${orderBy}
         LIMIT ? OFFSET ?`,
        bindings: [...bindings, limit, offset],
      },
      {
        sql: `SELECT COUNT(*) AS total
              FROM email_template_versions
              WHERE template_key = ?
              ${searchSql}`,
        bindings,
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
