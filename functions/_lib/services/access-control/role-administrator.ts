import { staffPermissionPredicate } from "../../auth/permissions";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";

// One active person must retain both global access-management permissions,
// whether supplied by several roles, direct grants, or both.
const ACCESS_ADMINISTRATOR_SQL = `SELECT 1 FROM users u WHERE u.active = 1
  AND ${staffPermissionPredicate("u", true)} AND ${staffPermissionPredicate("u", true)} LIMIT 1`;
const ACCESS_ADMINISTRATOR_BINDINGS = ["access:grant", "access:grant", "access:revoke", "access:revoke"];

export async function requireRemainingAccessAdministrator(
  db: DatabaseLike,
  roleId: string,
  permissions: readonly string[],
): Promise<void> {
  const remaining = await first(
    db,
    `WITH role_permissions(role_id, permission) AS (
    SELECT role_id, permission FROM main.role_permissions WHERE role_id != ?
    UNION ALL SELECT ?, value FROM json_each(?)
  ) ${ACCESS_ADMINISTRATOR_SQL}`,
    [roleId, roleId, JSON.stringify(permissions), ...ACCESS_ADMINISTRATOR_BINDINGS],
  );
  if (!remaining)
    throw new AppError(
      409,
      "LAST_ACCESS_ADMINISTRATOR",
      "At least one active administrator must retain global access grant and revoke permissions",
    );
}

/** Recheck the resulting bundles inside the same atomic command, after replacement. */
export function prepareAccessAdministratorGuard(db: DatabaseLike): StatementLike {
  return prepareAuthorizationGuard(db, { sql: ACCESS_ADMINISTRATOR_SQL, bindings: ACCESS_ADMINISTRATOR_BINDINGS });
}
