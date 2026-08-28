import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { guardDatabaseBatches } from "../../db/guarded-database";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import type { UserRecord } from "../users";

/** Rechecks the verified identity fields used to build an authenticated registration. */
export function prepareVerifiedRegistrationUserGuard(db: DatabaseLike, user: UserRecord): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM users
           WHERE id = ?
             AND active = 1
             AND normalized_email IS ?
             AND first_name IS ?
             AND last_name IS ?
             AND organization_name IS ?
             AND job_title IS ?
           LIMIT 1`,
    bindings: [user.id, user.normalized_email, user.first_name, user.last_name, user.organization_name, user.job_title],
  });
}

/** Rechecks selected-group membership and the event's live register capability. */
export function prepareGroupEventRegistrationGuard(
  db: DatabaseLike,
  input: { eventId: string; groupId: string; userId: string },
): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `SELECT 1
            FROM events event
            JOIN groups registration_group
              ON registration_group.id = ? AND registration_group.active = 1
           WHERE event.id = ?
             AND event.owner_group_id IS NOT NULL
             AND event.registration_mode <> 'no_registration'
             AND EXISTS (
               SELECT 1
                 FROM group_memberships membership
                WHERE membership.group_id = registration_group.id
                  AND membership.user_id = ?
                  AND membership.left_at IS NULL
             )
             AND (
               event.owner_group_id = registration_group.id
               OR EXISTS (
                 SELECT 1
                   FROM event_group_grants grant_row
                  WHERE grant_row.event_id = event.id
                    AND grant_row.group_id = registration_group.id
                    AND grant_row.capability = 'register'
               )
             )
           LIMIT 1`,
    bindings: [input.groupId, input.eventId, input.userId],
  });
}

/** Rechecks live membership and register access around every group-only configuration read. */
export function guardGroupEventRegistrationDatabase(
  db: DatabaseLike,
  input: { eventId: string; groupId: string; userId: string },
): DatabaseLike {
  return guardDatabaseBatches(db, async (statements) => {
    try {
      const [, ...results] = await db.batch([prepareGroupEventRegistrationGuard(db, input), ...statements]);
      return results;
    } catch (error) {
      if (isAuthorizationGuardFailure(error)) {
        throw new AppError(403, "EVENT_REGISTRATION_ACCESS_REQUIRED", "Registration access is required");
      }
      throw error;
    }
  });
}
