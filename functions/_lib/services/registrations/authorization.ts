import { guardAuthorizedDatabase, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import type { UserRecord } from "../users";
import { inviteColumnProjection, type InviteRecord } from "../invite-types";
import { nowIso } from "../../utils/time";
import { accountAddressSignsInSql } from "../../auth/email-sign-in-policy";
import { userProfileSchema } from "../../../../assets/shared/schemas/registration";
import { z } from "zod";

/** Read models tolerate legacy names; a new registration requires a corrected canonical profile. */
export function requireRegistrationUserProfile(user: UserRecord) {
  const profile = userProfileSchema.safeParse({
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
  });
  if (!profile.success)
    throw new AppError(
      422,
      "REGISTRATION_PROFILE_INCOMPLETE",
      "Edit your personal details and save a valid first and last name before registering.",
      z.flattenError(profile.error),
    );
  return profile.data;
}

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

/**
 * Whether an invitation was sent to one of this account's own addresses: one
 * that still signs the person in, so a work address retired when their
 * representation ended no longer counts.
 */
export async function inviteSentToAccount(db: DatabaseLike, userId: string, inviteeEmail: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS owned FROM (SELECT ? AS id, ? AS email) account
        WHERE ${accountAddressSignsInSql("account.id", "account.email")}`,
    )
    .bind(userId, inviteeEmail)
    .first<{ owned: number }>();
  return Boolean(row);
}

/**
 * The registration group that gives a user live register access to an event:
 * a current membership of the owner group or of a group granted `register`.
 * Expressions are trusted SQL (placeholders or correlated columns), never input.
 */
function registrationGroupSelectionSql(eventIdSql: string, userIdSql: string, groupIdSql?: string): string {
  return `SELECT registration_group.id AS groupId
            FROM events event
            JOIN groups registration_group
              ON registration_group.active = 1
           WHERE event.id = ${eventIdSql}
             ${groupIdSql ? `AND registration_group.id = ${groupIdSql}` : ""}
             AND event.owner_group_id IS NOT NULL
             AND event.registration_mode NOT IN ('no_registration', 'automatic')
             AND EXISTS (
               SELECT 1
                 FROM group_memberships membership
                WHERE membership.group_id = registration_group.id
                  AND membership.user_id = ${userIdSql}
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
             )`;
}

/** Whether the user holds group register access, as a predicate over a correlated event and user. */
export function groupEventRegistrationAccessExistsSql(eventIdSql: string, userIdSql: string): string {
  return `EXISTS (${registrationGroupSelectionSql(eventIdSql, userIdSql)})`;
}

/** Rechecks selected-group membership and the event's live register capability. */
function groupEventRegistrationEvidence(input: { eventId: string; groupId?: string; userId: string }) {
  // Placeholders bind in text order: event, then the selected group, then the user.
  return {
    sql: `${registrationGroupSelectionSql("?", "?", input.groupId ? "?" : undefined)}
           ORDER BY (event.owner_group_id = registration_group.id) DESC, registration_group.id
           LIMIT 1`,
    bindings: [input.eventId, ...(input.groupId ? [input.groupId] : []), input.userId],
  };
}

/**
 * The access a signed-in person brings without an invitation link, read in one batch: an attendee
 * invitation sent to the account's address (its session proved that mailbox, so a link opened in
 * another browser still counts), and group access from live memberships and event grants, never
 * request-supplied group IDs.
 */
export async function readRegistrationAccessEvidence(
  db: DatabaseLike,
  input: { eventId: string; userId: string; discoverGroup: boolean },
): Promise<{ invite: InviteRecord | null; registrationGroupId: string | undefined }> {
  const group = groupEventRegistrationEvidence(input);
  const [inviteResult, groupResult] = await db.batch([
    db
      .prepare(
        `SELECT ${inviteColumnProjection("invites")} FROM invites, (SELECT ? AS id) account
          WHERE invites.event_id = ? AND invites.invite_type = 'attendee' AND invites.status = 'sent'
            AND ${accountAddressSignsInSql("account.id", "invites.invitee_email")}
            AND (invites.expires_at IS NULL OR invites.expires_at > ?)
          ORDER BY invites.created_at ASC LIMIT 1`,
      )
      .bind(input.userId, input.eventId, nowIso()),
    ...(input.discoverGroup ? [db.prepare(group.sql).bind(...group.bindings)] : []),
  ]);
  return {
    invite: batchFirst<InviteRecord>(inviteResult) ?? null,
    registrationGroupId: groupResult ? batchFirst<{ groupId: string }>(groupResult)?.groupId : undefined,
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
