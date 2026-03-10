/**
 * DELETE /api/v1/admin/events/:eventSlug/permissions/:permId
 *
 * Revokes a specific event-level permission grant.
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { first, run } from "../../../../../../_lib/db/queries";
import { writeAuditLog } from "../../../../../../_lib/services/audit";
import type { PagesContext } from "../../../../../../_lib/types";

interface PermRow {
  id: string;
  user_email: string;
  permission: string;
}

export async function onRequestDelete(
  context: PagesContext<{ eventSlug: string; permId: string }>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(context.env.DB, context.request, context.env);
  const event = await getEventBySlug(context.env.DB, context.params.eventSlug);

  const perm = await first<PermRow>(
    context.env.DB,
    "SELECT id, user_email, permission FROM event_permissions WHERE id = ? AND event_id = ?",
    [context.params.permId, event.id],
  );

  if (!perm) {
    return json({ error: { code: "NOT_FOUND", message: "Permission grant not found" } }, 404);
  }

  await run(
    context.env.DB,
    "DELETE FROM event_permissions WHERE id = ?",
    [perm.id],
  );

  await writeAuditLog(
    context.env.DB,
    "admin",
    admin.id,
    "event_permission_revoked",
    "event",
    event.id,
    { email: perm.user_email, permission: perm.permission },
  );

  return json({ success: true });
}

export async function onRequest(
  context: PagesContext<{ eventSlug: string; permId: string }>,
): Promise<Response> {
  if (context.request.method !== "DELETE") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestDelete(context);
}
