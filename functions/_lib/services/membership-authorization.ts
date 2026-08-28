import type { Permission } from "../../../assets/shared/schemas/permissions";
import { guardPermissionMutationDatabase } from "../auth/permissions";
import { AppError } from "../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../types";

/**
 * Rechecks a user-backed staff actor's live membership permissions inside the
 * mutation batch. A permission revoke after request authentication therefore
 * rolls back the complete membership command and its audit rows.
 */
export function authorizedMembershipMutationDb(
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
        "MEMBERSHIP_AUTHORIZATION_CHANGED",
        "Membership permission changed while the update was being saved",
      ),
  );
}
