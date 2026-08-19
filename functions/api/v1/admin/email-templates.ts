import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { all, first } from "../../../_lib/db/queries";
import { resolveOrderBy } from "../../../_lib/db/sort";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import {
  ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS,
  emailTemplatesListRouteSchema,
} from "../../../../assets/shared/schemas/admin-email-templates";

export const EmailTemplatesList = openApiRoute(emailTemplatesListRouteSchema, async (c: AdminContext, data) => {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const { q, sort, limit = 50, offset = 0 } = data.query;
  const orderBy = resolveOrderBy(sort, ADMIN_EMAIL_TEMPLATES_SORT_COLUMNS, "ORDER BY template_key ASC");

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (q) {
    conditions.push("template_key LIKE ?");
    bindings.push(`%${q}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [templates, totalRow] = await Promise.all([
    all<{
      template_key: string;
      active_version: number | null;
      version_count: number;
      draft_count: number;
    }>(
      requestDb(c),
      `SELECT
         template_key,
         MAX(CASE WHEN status = 'active' THEN version END) AS active_version,
         COUNT(*) AS version_count,
         SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS draft_count
       FROM email_template_versions
       ${where}
       GROUP BY template_key
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [...bindings, limit, offset],
    ),
    first<{ total: number }>(
      requestDb(c),
      `SELECT COUNT(DISTINCT template_key) AS total FROM email_template_versions ${where}`,
      bindings,
    ),
  ]);

  const total = Number(totalRow?.total ?? 0);

  return json({
    templates,
    page: buildPageInfo(limit, offset, total, templates.length),
  });
});
