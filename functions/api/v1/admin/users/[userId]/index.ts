/**
 * GET  /api/v1/admin/users/:userId  — full user detail
 * PATCH /api/v1/admin/users/:userId — update role / active flag
 *
 * Only a global admin may call these endpoints.
 */
import { parseJsonBody } from "../../../../../_lib/validation";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { first, run } from "../../../../../_lib/db/queries";
import { nowIso } from "../../../../../_lib/utils/time";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { AppError } from "../../../../../_lib/errors";
import type { PagesContext } from "../../../../../_lib/types";
import { adminUserUpdateSchema } from "../../../../../../shared/schemas/api";

interface UserRow {
  id: string;
  email: string;
  role: string;
  active: number;
  pii_redacted_at: string | null;
}

interface UserDetailRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  role: string;
  active: number;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
  created_at: string;
  updated_at: string;
  pii_redacted_at: string | null;
}

// ── GET ─────────────────────────────────────────────────────────────────────

export async function onRequestGet(
  context: PagesContext<{ userId: string }>,
): Promise<Response> {
  await requireAdminFromRequest(context.env.DB, context.request, context.env);

  const user = await first<UserDetailRow>(
    context.env.DB,
    `SELECT id, email, first_name, last_name, preferred_name,
            organization_name, job_title, biography, role, active,
            headshot_r2_key, headshot_updated_at,
            created_at, updated_at, pii_redacted_at
     FROM users WHERE id = ?`,
    [context.params.userId],
  );

  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  // Build a public headshot URL from the R2 key (unguessable capability URL)
  let headshotUrl: string | null = null;
  if (user.headshot_r2_key) {
    // R2 key is "headshots/{userId}/{timestamp}.{ext}" → public URL
    headshotUrl = `/api/v1/${user.headshot_r2_key}`;
  }

  return json({
    user: {
      ...user,
      active: Boolean(user.active),
      headshotUrl,
    },
  });
}

// ── PATCH ───────────────────────────────────────────────────────────────────

export async function onRequestPatch(
  context: PagesContext<{ userId: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const body = await parseJsonBody(context.request, adminUserUpdateSchema);

  // Prevent self-demotion / self-deactivation
  if (context.params.userId === admin.id) {
    if (body.role !== undefined && body.role !== "admin") {
      throw new AppError(403, "FORBIDDEN", "You cannot demote your own account");
    }
    if (body.active === false) {
      throw new AppError(403, "FORBIDDEN", "You cannot deactivate your own account");
    }
  }

  const user = await first<UserRow>(
    context.env.DB,
    "SELECT id, email, role, active, pii_redacted_at FROM users WHERE id = ?",
    [context.params.userId],
  );

  if (!user) {
    throw new AppError(404, "NOT_FOUND", "User not found");
  }

  const newRole   = body.role   ?? user.role;
  const newActive = body.active ?? Boolean(user.active);

  await run(
    context.env.DB,
    "UPDATE users SET role = ?, active = ?, updated_at = ? WHERE id = ?",
    [newRole, newActive ? 1 : 0, nowIso(), user.id],
  );

  const changes: Record<string, unknown> = {};
  if (body.role !== undefined && body.role !== user.role) {
    changes.role = { from: user.role, to: newRole };
  }
  if (body.active !== undefined && body.active !== Boolean(user.active)) {
    changes.active = { from: Boolean(user.active), to: newActive };
  }

  if (Object.keys(changes).length > 0) {
    await writeAuditLog(
      context.env.DB,
      "admin",
      admin.id,
      "user_updated",
      "user",
      user.id,
      changes,
    );
  }

  return json({
    success: true,
    user: { id: user.id, email: user.email, role: newRole, active: newActive },
  });
}

export async function onRequest(
  context: PagesContext<{ userId: string }>,
): Promise<Response> {
  if (context.request.method === "GET")   return onRequestGet(context);
  if (context.request.method === "PATCH") return onRequestPatch(context);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
