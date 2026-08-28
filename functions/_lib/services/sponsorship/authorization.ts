import { guardPermissionMutationDatabase } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";

/**
 * Rechecks a staff member's sponsorship write grant in every D1 mutation
 * batch. A revocation after HTTP authentication but before commit therefore
 * cannot leave a partial sponsorship, audit, or outbox transition behind.
 */
export function authorizedSponsorshipMutationDb(db: DatabaseLike, actor: UserBackedAuthAdmin): DatabaseLike {
  return guardPermissionMutationDatabase(
    db,
    actor,
    [{ permission: "sponsorships:write" }],
    () =>
      new AppError(
        409,
        "SPONSORSHIP_AUTHORIZATION_CHANGED",
        "Sponsorship permission changed while the update was being saved",
      ),
  );
}
