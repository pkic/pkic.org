import { guardPermissionMutationDatabase } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";

export function authorizedOrganizationMutationDb(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  permission: "organizations:write" | "membership:write",
): DatabaseLike {
  return guardPermissionMutationDatabase(
    db,
    actor,
    [{ permission }],
    () =>
      new AppError(
        409,
        "ORGANIZATION_AUTHORIZATION_CHANGED",
        "Organization permission changed while the update was being saved",
      ),
  );
}
