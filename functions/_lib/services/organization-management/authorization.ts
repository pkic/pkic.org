import { guardPermissionMutationDatabase } from "../../auth/permissions";
import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";

export function authorizedOrganizationMutationDb(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  permission: Permission | readonly Permission[],
): DatabaseLike {
  const permissions = Array.isArray(permission) ? permission : [permission];
  return guardPermissionMutationDatabase(
    db,
    actor,
    permissions.map((item) => ({ permission: item })),
    () =>
      new AppError(
        409,
        "ORGANIZATION_AUTHORIZATION_CHANGED",
        "Organization permission changed while the update was being saved",
      ),
  );
}
