/**
 * PATCH /api/v1/admin/users/:userId
 *
 * Updates a user's global role (admin | user | guest) and/or active flag.
 * Only a global admin may call this endpoint.
 *
 * Body (application/json) — at least one field required:
 *   role   — "admin" | "user" | "guest"
 *   active — boolean  (false = deactivated, true = reactivated)
 */
import { parseJsonBody } from "../../../../_lib/validation";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { first, run } from "../../../../_lib/db/queries";
import { nowIso } from "../../../../_lib/utils/time";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { adminUserUpdateSchema } from "../../../../../assets/shared/schemas/api";

interface UserRow {
  id: string;
  email: string;
  role: string;
  active: number;
  pii_redacted_at: string | null;
}

export async function onRequestPatch(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, adminUserUpdateSchema);
  const userId = c.req.param("userId");

  // Prevent self-demotion / self-deactivation
  if (userId === admin.id) {
    if (body.role !== undefined && body.role !== "admin") {
      return json({ error: { code: "FORBIDDEN", message: "You cannot demote your own account" } }, 403);
    }
    if (body.active === false) {
      return json({ error: { code: "FORBIDDEN", message: "You cannot deactivate your own account" } }, 403);
    }
  }

  const user = await first<UserRow>(
    c.env.DB,
    "SELECT id, email, role, active, pii_redacted_at FROM users WHERE id = ?",
    [userId],
  );

  if (!user) {
    return json({ error: { code: "NOT_FOUND", message: "User not found" } }, 404);
  }

  const newRole = body.role ?? user.role;
  const newActive = body.active ?? Boolean(user.active);

  await run(c.env.DB, "UPDATE users SET role = ?, active = ?, updated_at = ? WHERE id = ?", [
    newRole,
    newActive ? 1 : 0,
    nowIso(),
    user.id,
  ]);

  const changes: Record<string, unknown> = {};
  if (body.role !== undefined && body.role !== user.role) {
    changes.role = { from: user.role, to: newRole };
  }
  if (body.active !== undefined && body.active !== Boolean(user.active)) {
    changes.active = { from: Boolean(user.active), to: newActive };
  }

  if (Object.keys(changes).length > 0) {
    await writeAuditLog(c.env.DB, "admin", admin.id, "user_updated", "user", user.id, changes);
  }

  return json({
    success: true,
    user: { id: user.id, email: user.email, role: newRole, active: newActive },
  });
}

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method !== "PATCH") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestPatch(c);
}
