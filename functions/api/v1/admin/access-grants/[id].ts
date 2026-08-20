/**
 * DELETE /api/v1/admin/access-grants/:id — revoke a permission grant
 *
 * Sets `revoked_at` (soft delete) and writes an audit_log entry,
 * tests/permission-grants.test.ts.
 */
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { first } from "../../../../_lib/db/queries";
import { nowIso } from "../../../../_lib/utils/time";
import { prepareAuditLog } from "../../../../_lib/services/audit";
import { accessGrantRevokeRouteSchema } from "../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

interface GrantRow {
  id: string;
  user_id: string;
  permission: string;
}

export const AccessGrantsRevoke = openApiRoute(accessGrantRevokeRouteSchema, async (c: AdminContext, data) => {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:revoke");

  const grant = await first<GrantRow>(
    requestDb(c),
    "SELECT id, user_id, permission FROM permission_grants WHERE id = ? AND revoked_at IS NULL",
    [data.params.id],
  );

  if (!grant) {
    return json({ error: { code: "NOT_FOUND", message: "Grant not found" } }, 404);
  }

  const now = nowIso();
  await requestDb(c).batch([
    requestDb(c).prepare("UPDATE permission_grants SET revoked_at = ? WHERE id = ?").bind(now, grant.id),
    prepareAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "access_grant_revoked",
      "permission_grant",
      grant.id,
      { userId: grant.user_id, permission: grant.permission },
      now,
    ),
  ]);

  return json({ success: true });
});
