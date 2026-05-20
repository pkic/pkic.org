import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { all, first } from "../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const url = new URL(c.req.raw.url);
  const search = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (search) {
    conditions.push("template_key LIKE ?");
    bindings.push(`%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = await all<{
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
     ORDER BY template_key ASC
     LIMIT ? OFFSET ?`,
    [...bindings, limit + 1, offset],
  );

  const hasMore = rows.length > limit;
  const templates = hasMore ? rows.slice(0, limit) : rows;

  const totalRow = await first<{ total: number }>(
    requestDb(c),
    `SELECT COUNT(DISTINCT template_key) AS total FROM email_template_versions ${where}`,
    bindings,
  );
  const total = Number(totalRow?.total ?? 0);

  return json({
    templates,
    page: { limit, offset, hasMore, total },
  });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
