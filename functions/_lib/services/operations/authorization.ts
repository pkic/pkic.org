import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { guardPermissionMutationDatabase } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";

/** Rechecks every exact permission before each D1 mutation batch in a manual operation. */
export function authorizedOperationsMutationDb(
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
        "OPERATIONS_AUTHORIZATION_CHANGED",
        "Operation permission changed while the command was running",
      ),
  );
}
