import type { Permission } from "../../../assets/shared/schemas/permissions";
import { guardPermissionMutationDatabase } from "../auth/permissions";
import { AppError } from "../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../types";

/** Rechecks every required staff grant within the user mutation's D1 batch. */
export function authorizedUserMutationDb(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  permissions: readonly Permission[],
): DatabaseLike {
  return guardPermissionMutationDatabase(
    db,
    actor,
    permissions.map((permission) => ({ permission })),
    () =>
      new AppError(
        409,
        "USER_AUTHORIZATION_CHANGED",
        "User-management permission changed while the update was being saved",
      ),
  );
}
