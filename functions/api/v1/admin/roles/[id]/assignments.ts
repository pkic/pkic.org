/**
 * GET /api/v1/admin/roles/:id/assignments — reverse lookup: every active
 * holder of a role, across all contexts.
 *
 * Every other role-assignment screen in the admin portal starts from a user
 * ("what roles does this person hold?" — GET /api/v1/admin/users/:userId/roles).
 * The Chairs tab (PRD issue "create a chairs tab for the forum + each WG")
 * needs the reverse: "who currently holds role-forum_chair?" — with no user
 * already picked. This is that lookup, generic over any role id so it also
 * backs the WG chair/vice-chair display without a second endpoint.
 */
import { OpenAPIRoute } from "chanfana";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requirePermission } from "../../../../../_lib/auth/permissions";
import { all, first } from "../../../../../_lib/db/queries";
import { AppError } from "../../../../../_lib/errors";
import { roleAssignmentsListRouteSchema } from "../../../../../../assets/shared/schemas/access-control";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";

interface RoleAssignmentRow {
  user_role_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  context_type: string | null;
  context_id: string | null;
  expires_at: string | null;
  created_at: string;
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  requirePermission(admin, "access:grant");

  const roleId = c.req.param("id");
  const role = await first<{ id: string }>(requestDb(c), "SELECT id FROM roles WHERE id = ?", [roleId]);
  if (!role) {
    throw new AppError(404, "NOT_FOUND", "Role not found");
  }

  const rows = await all<RoleAssignmentRow>(
    requestDb(c),
    `SELECT ur.id AS user_role_id, u.id AS user_id, u.first_name, u.last_name, u.email,
            ur.context_type, ur.context_id, ur.expires_at, ur.created_at
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     WHERE ur.role_id = ?
       AND ur.revoked_at IS NULL
       AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ORDER BY ur.created_at DESC`,
    [roleId],
  );

  return json({
    assignments: rows.map((r) => ({
      userRoleId: r.user_role_id,
      userId: r.user_id,
      name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.email,
      email: r.email,
      contextType: r.context_type,
      contextId: r.context_id,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    })),
  });
}

export class RoleAssignmentsList extends OpenAPIRoute {
  schema = roleAssignmentsListRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}
