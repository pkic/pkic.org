import { guardPermissionMutationDatabase } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";

/** Rechecks a staff member's email-management grant in each D1 mutation batch. */
export function authorizedEmailOutboxMutationDb(db: DatabaseLike, actor: UserBackedAuthAdmin): DatabaseLike {
  return guardPermissionMutationDatabase(
    db,
    actor,
    [{ permission: "email:read" }, { permission: "email:manage" }],
    () =>
      new AppError(
        409,
        "EMAIL_OUTBOX_AUTHORIZATION_CHANGED",
        "Email permission changed while the operation was running",
      ),
  );
}
