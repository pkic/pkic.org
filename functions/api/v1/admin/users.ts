/**
 * GET /api/v1/admin/users
 *
 * Returns a pageable list of users.  Designed for the admin console's user
 * management section; supports filtering by role and a simple email/name search.
 *
 * Query params:
 *   role   — filter to a specific role (admin | user | guest)
 *   search — partial match against email or name
 *   limit  — max rows (default 100, max 500)
 *   offset — pagination offset (default 0)
 */
import { json } from "../../../_lib/http";
import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { all, first } from "../../../_lib/db/queries";

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  role: string;
  active: number;
  created_at: string;
}

export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);

  const url = new URL(c.req.raw.url);
  const role = url.searchParams.get("role") ?? "";
  const search = (url.searchParams.get("q") ?? url.searchParams.get("search") ?? "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50") || 50, 500);
  const offset = parseInt(url.searchParams.get("offset") ?? "0") || 0;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (role) {
    conditions.push("u.role = ?");
    params.push(role);
  }

  if (search) {
    conditions.push("(u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ?)");
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const users = await all<UserRow>(
    c.env.DB,
    `SELECT u.id, u.email, u.first_name, u.last_name, u.organization_name, u.role, u.active, u.created_at
     FROM users u
     ${where}
     ORDER BY u.role ASC, u.email ASC
     LIMIT ? OFFSET ?`,
    [...params, limit + 1, offset],
  );

  const hasMore = users.length > limit;
  const rows = hasMore ? users.slice(0, limit) : users;

  const totalRow = await first<{ total: number }>(c.env.DB, `SELECT COUNT(*) AS total FROM users u ${where}`, params);
  const total = Number(totalRow?.total ?? 0);

  return json({
    users: rows,
    page: { limit, offset, hasMore, total },
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(c);
}
