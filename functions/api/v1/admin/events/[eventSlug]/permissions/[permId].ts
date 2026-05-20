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
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

interface PermRow {
  id: string;
  user_email: string;
  permission: string;
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));

  const perm = await first<PermRow>(
    requestDb(c),
    "SELECT id, user_email, permission FROM event_permissions WHERE id = ? AND event_id = ?",
    [c.req.param("permId"), event.id],
  );

  if (!perm) {
    return json({ error: { code: "NOT_FOUND", message: "Permission grant not found" } }, 404);
  }

  await run(requestDb(c), "DELETE FROM event_permissions WHERE id = ?", [perm.id]);

  await writeAuditLog(requestDb(c), "admin", admin.id, "event_permission_revoked", "event", event.id, {
    email: perm.user_email,
    permission: perm.permission,
  });

  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "DELETE") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestDelete(c);
}
