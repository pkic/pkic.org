import { guardAuthorizedDatabase, prepareAuthorizationGuard } from "../../db/authorization-guard";
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
           LIMIT 1`,
    bindings: [user.id, user.normalized_email, user.first_name, user.last_name],
  });
}

/** Rechecks selected-group membership and the event's live register capability. */
function groupEventRegistrationEvidence(input: { eventId: string; groupId: string; userId: string }) {
  return {
    sql: `SELECT 1
            FROM events event
            JOIN groups registration_group
              ON registration_group.id = ? AND registration_group.active = 1
           WHERE event.id = ?
             AND event.owner_group_id IS NOT NULL
             AND event.registration_mode NOT IN ('no_registration', 'automatic')
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
  };
}

export function prepareGroupEventRegistrationGuard(
  db: DatabaseLike,
  input: { eventId: string; groupId: string; userId: string },
): StatementLike {
  return prepareAuthorizationGuard(db, groupEventRegistrationEvidence(input));
}

/** Rechecks live membership and register access around every group-only configuration read. */
export function guardGroupEventRegistrationDatabase(
  db: DatabaseLike,
  input: { eventId: string; groupId: string; userId: string },
): DatabaseLike {
  return guardAuthorizedDatabase(
    db,
    groupEventRegistrationEvidence(input),
    () => new AppError(403, "EVENT_REGISTRATION_ACCESS_REQUIRED", "Registration access is required"),
  );
}
