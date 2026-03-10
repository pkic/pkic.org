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
import { all } from "../../../_lib/db/queries";
import type { PagesContext } from "../../../_lib/types";

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

export async function onRequestGet(context: PagesContext): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const url = new URL(context.request.url);
  const role   = url.searchParams.get("role")   ?? "";
  const search = (url.searchParams.get("search") ?? "").trim();
  const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "100") || 100, 500);
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
    context.env.DB,
    `SELECT u.id, u.email, u.first_name, u.last_name, u.organization_name, u.role, u.active, u.created_at
     FROM users u
     ${where}
     ORDER BY u.role ASC, u.email ASC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return json({ users, limit, offset });
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method !== "GET") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestGet(context);
}
