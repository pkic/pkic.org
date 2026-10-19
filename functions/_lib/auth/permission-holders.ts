import { all } from "../db/queries";
import type { DatabaseLike } from "../types";
import type { Permission } from "../../../assets/shared/schemas/permissions";
import type { PermissionContext } from "./permissions";

export interface PermissionHolder {
  id: string;
  email: string;
  first_name: string | null;
}

/**
 * Who holds `permission` for `context`, by the rule every request is
 * authorized with: the grant sources `computeGrantsForUser` reads (roles,
 * including capacity-bound group roles while that membership lasts, and direct
 * grants), matched the way `hasPermission` matches them — a global grant, or a
 * grant scoped to exactly this context. Each active person appears once, in a
 * stable order, at most `limit` of them.
 */
export function listPermissionHolders(
  db: DatabaseLike,
  input: { permission: Permission; context: PermissionContext; limit: number },
): Promise<PermissionHolder[]> {
  const scoped = (alias: string) =>
    `((${alias}.context_type IS NULL AND ${alias}.context_id IS NULL)
      OR (${alias}.context_type = ? AND ${alias}.context_id = ?))`;
  return all<PermissionHolder>(
    db,
    `SELECT person.id, person.email, person.first_name
       FROM users person
      WHERE person.active = 1 AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM user_roles role
              JOIN role_permissions role_permission ON role_permission.role_id = role.role_id
             WHERE role.user_id = person.id AND role_permission.permission = ?
               AND role.revoked_at IS NULL
               AND (role.expires_at IS NULL OR role.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               AND (
                 role.member_id IS NULL
                 OR (role.context_type = 'group' AND EXISTS (
                   SELECT 1 FROM group_memberships membership
                    WHERE membership.group_id = role.context_id AND membership.user_id = role.user_id
                      AND membership.member_id = role.member_id AND membership.left_at IS NULL))
               )
               AND ${scoped("role")}
          )
          OR EXISTS (
            SELECT 1 FROM permission_grants grant_row
             WHERE grant_row.user_id = person.id AND grant_row.permission = ?
               AND grant_row.revoked_at IS NULL
               AND (grant_row.expires_at IS NULL OR grant_row.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               AND ${scoped("grant_row")}
          )
        )
      ORDER BY person.id
      LIMIT ?`,
    [
      input.permission,
      input.context.type,
      input.context.id,
      input.permission,
      input.context.type,
      input.context.id,
      input.limit,
    ],
  );
}
