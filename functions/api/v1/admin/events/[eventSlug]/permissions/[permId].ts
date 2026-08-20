/**
 * DELETE /api/v1/admin/events/:eventSlug/permissions/:permId
 *
 * Revokes a specific event-level role grant (Sets `revoked_at` on
 * the backing `user_roles` row rather than deleting it — see migration
 * 0035 and functions/api/v1/admin/events/[eventSlug]/permissions.ts).
 */
import { json } from "../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../../_lib/auth/permissions";
import { getEventBySlug } from "../../../../../../_lib/services/events";
import { first } from "../../../../../../_lib/db/queries";
import { nowIso } from "../../../../../../_lib/utils/time";
import { prepareAuditLog } from "../../../../../../_lib/services/audit";
import { requestDb, type AdminContext } from "../../../../../../_lib/db/context";

interface PermRow {
  id: string;
  user_email: string | null;
  role_id: string;
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  requirePermission(admin, "events:manage", { type: "event", id: event.id });

  const perm = await first<PermRow>(
    requestDb(c),
    `SELECT id, user_email, role_id FROM user_roles
     WHERE id = ? AND context_type = 'event' AND context_id = ? AND revoked_at IS NULL`,
    [c.req.param("permId"), event.id],
  );

  if (!perm) {
    return json({ error: { code: "NOT_FOUND", message: "Permission grant not found" } }, 404);
  }

  const now = nowIso();
  await requestDb(c).batch([
    requestDb(c).prepare("UPDATE user_roles SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, perm.id),
    prepareAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "event_permission_revoked",
      "event",
      event.id,
      { email: perm.user_email, role_id: perm.role_id },
      now,
    ),
  ]);

  return json({ success: true });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method !== "DELETE") {
    return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
  }
  return onRequestDelete(c);
}
