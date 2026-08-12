/**
 * DELETE /api/v1/admin/access-grants/:id — revoke a permission grant
 *
 * Sets `revoked_at` (soft delete) and writes an audit_log entry,
 * tests/permission-grants.test.ts.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { requirePermission } from "../../../../_lib/auth/permissions";
import { first, run } from "../../../../_lib/db/queries";
import { nowIso } from "../../../../_lib/utils/time";
import { writeAuditLog } from "../../../../_lib/services/audit";
import { accessGrantRevokeRouteSchema } from "../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";

interface GrantRow {
  id: string;
  user_id: string;
  permission: string;
}

export async function onRequestDelete(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:revoke");

  const grant = await first<GrantRow>(
    requestDb(c),
    "SELECT id, user_id, permission FROM permission_grants WHERE id = ? AND revoked_at IS NULL",
    [c.req.param("id")],
  );

  if (!grant) {
    return json({ error: { code: "NOT_FOUND", message: "Grant not found" } }, 404);
  }

  await run(requestDb(c), "UPDATE permission_grants SET revoked_at = ? WHERE id = ?", [nowIso(), grant.id]);

  await writeAuditLog(requestDb(c), "admin", admin.id, "access_grant_revoked", "permission_grant", grant.id, {
    userId: grant.user_id,
    permission: grant.permission,
  });

  return json({ success: true });
}

export class AccessGrantsRevoke extends OpenAPIRoute {
  schema = accessGrantRevokeRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestDelete(c);
  }
}
