/**
 * Reinstating an ended organization identity: an end made in error is undone
 * by removing the end date from the same identity, not by starting a new one.
 *
 * The identity's end trigger closed every group seat held through it at
 * MAX(joined_at, ended_at) and revoked every role at MAX(created_at, ended_at);
 * group leadership closed with its seat at the seat's end. Reinstating reopens
 * exactly the seats and roles that end closed and that can still be held, then
 * reruns automatic enrollment so current policy decides the rest. A seat or
 * role that ended at another moment stays ended.
 */
import { prepareOrganizationIdentityPublication } from "./lifecycle-publication";
import { prepareAuthorizationGuard, type AuthorizationEvidence } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAutomaticGroupEnrollmentForUserStatements } from "../groups/automatic-enrollment";
import { prepareIdentityEmailOwnershipStatements, requireIdentityEmailAssignable } from "./email-ownership";
import { prepareIdentityNotification, type IdentityNotificationContext } from "./notifications";

/**
 * The one eligibility rule, for an identity row aliased `identity`: an ended,
 * never-blocked organization identity that no successor replaced, while its
 * person holds no other active or pending identity for the same organization.
 */
export const REINSTATABLE_IDENTITY_SQL = `identity.organization_id IS NOT NULL
  AND identity.started_at IS NOT NULL
  AND identity.ended_at IS NOT NULL
  AND identity.blocked_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM identities successor WHERE successor.predecessor_identity_id = identity.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM identities other
     WHERE other.user_id = identity.user_id
       AND other.organization_id = identity.organization_id
       AND other.id <> identity.id
       AND other.ended_at IS NULL AND other.blocked_at IS NULL
  )`;

export interface ReinstatementCandidate {
  id: string;
  member_id: string | null;
  user_id: string;
  organization_id: string | null;
  email_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  blocked_at: string | null;
  updated_at: string;
  has_successor: number;
  has_other_live_identity: number;
}

/** Reads one identity with the facts that decide whether it can be reinstated. */
export async function loadReinstatementCandidate(
  db: DatabaseLike,
  input: { identityId: string; organizationId?: string },
): Promise<ReinstatementCandidate | null> {
  return first<ReinstatementCandidate>(
    db,
    `SELECT identity.id, capacity.member_id, identity.user_id, identity.organization_id, identity.email_id,
            identity.started_at, identity.ended_at, identity.blocked_at, identity.updated_at,
            EXISTS (SELECT 1 FROM identities successor
                     WHERE successor.predecessor_identity_id = identity.id) AS has_successor,
            EXISTS (SELECT 1 FROM identities other
                     WHERE other.user_id = identity.user_id
                       AND other.organization_id = identity.organization_id
                       AND other.id <> identity.id
                       AND other.ended_at IS NULL AND other.blocked_at IS NULL) AS has_other_live_identity
       FROM identities identity
       LEFT JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
      WHERE identity.id = ? AND (? IS NULL OR identity.organization_id = ?)`,
    [input.identityId, input.organizationId ?? null, input.organizationId ?? null],
  );
}

export type ReinstatableIdentity = ReinstatementCandidate & {
  organization_id: string;
  started_at: string;
  ended_at: string;
};

/** Refuses with the specific reason an identity cannot be reinstated. */
export function requireReinstatable(candidate: ReinstatementCandidate): ReinstatableIdentity {
  if (!candidate.ended_at) {
    throw new AppError(409, "IDENTITY_NOT_ENDED", "Only an ended identity can be reinstated");
  }
  if (!candidate.organization_id || !candidate.started_at || candidate.blocked_at) {
    throw new AppError(
      409,
      "IDENTITY_NOT_REINSTATABLE",
      "Only an organization identity that was active and was not blocked can be reinstated",
    );
  }
  if (candidate.has_successor) {
    throw new AppError(409, "IDENTITY_SUPERSEDED", "A later identity already replaced this one");
  }
  if (candidate.has_other_live_identity) {
    throw new AppError(
      409,
      "IDENTITY_CONFLICT",
      "This person already has an active or pending identity for this organization",
    );
  }
  return candidate as ReinstatableIdentity;
}

/** The identity is still exactly the ended, reinstatable row that was read. */
export function reinstatableIdentityEvidence(identity: ReinstatableIdentity): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM identities identity
           WHERE identity.id = ? AND identity.updated_at = ? AND identity.ended_at = ?
             AND ${REINSTATABLE_IDENTITY_SQL}`,
    bindings: [identity.id, identity.updated_at, identity.ended_at],
  };
}

/** Checks everything a reinstatement needs before its batch: eligibility, the address, and the seat levels. */
export async function planReinstatement(
  db: DatabaseLike,
  candidate: ReinstatementCandidate,
): Promise<{ identity: ReinstatableIdentity; seatDepth: number }> {
  const identity = requireReinstatable(candidate);
  await requireIdentityEmailAssignable(db, {
    userId: identity.user_id,
    emailId: identity.email_id,
    identityId: identity.id,
  });
  return { identity, seatDepth: await loadClosedSeatDepth(db, identity) };
}

/** How many group levels the seats closed by the end span; each level reopens after its parent. */
async function loadClosedSeatDepth(db: DatabaseLike, identity: ReinstatableIdentity): Promise<number> {
  const row = await first<{ depth: number | null }>(
    db,
    `WITH RECURSIVE lineage(depth, parent_group_id) AS (
       SELECT 0, g.parent_group_id
         FROM group_memberships seat JOIN groups g ON g.id = seat.group_id
        WHERE seat.identity_id = ? AND seat.left_at = MAX(seat.joined_at, ?)
       UNION ALL
       SELECT lineage.depth + 1, parent.parent_group_id
         FROM lineage JOIN groups parent ON parent.id = lineage.parent_group_id
        WHERE lineage.depth < 32
     )
     SELECT MAX(depth) AS depth FROM lineage`,
    [identity.id, identity.ended_at],
  );
  return row?.depth ?? 0;
}

/**
 * Reopens one level of the seats the end closed: the latest such seat per
 * group, while the capacity is still active, the group is active, and the
 * parent seat (for a subgroup) is open again. Run once per level so a
 * subgroup always follows its parent.
 */
function prepareReopenSeatsStatement(db: DatabaseLike, identity: ReinstatableIdentity, at: string): StatementLike {
  return db
    .prepare(
      `UPDATE group_memberships AS seat
          SET left_at = NULL, updated_at = ?
        WHERE seat.identity_id = ?
          AND seat.left_at = MAX(seat.joined_at, ?)
          AND seat.id = (
            SELECT latest.id FROM group_memberships latest
             WHERE latest.group_id = seat.group_id AND latest.identity_id = seat.identity_id
               AND latest.left_at = MAX(latest.joined_at, ?)
             ORDER BY latest.joined_at DESC, latest.id DESC LIMIT 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM group_memberships open_seat
             WHERE open_seat.group_id = seat.group_id AND open_seat.identity_id = seat.identity_id
               AND open_seat.left_at IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM identity_member_capacities capacity
             WHERE capacity.identity_id = seat.identity_id AND capacity.member_id = seat.member_id
               AND capacity.user_id = seat.user_id AND capacity.member_status = 'active'
          )
          AND EXISTS (
            SELECT 1 FROM groups g
             WHERE g.id = seat.group_id AND g.active = 1
               AND (
                 g.parent_group_id IS NULL
                 OR EXISTS (
                   SELECT 1 FROM group_memberships parent_seat
                    WHERE parent_seat.group_id = g.parent_group_id
                      AND parent_seat.user_id = seat.user_id AND parent_seat.left_at IS NULL
                 )
               )
          )`,
    )
    .bind(at, identity.id, identity.ended_at, identity.ended_at);
}

/**
 * Restores the roles the end revoked: a role revoked at MAX(created_at, end),
 * or group leadership revoked with its seat. Leadership needs its seat open
 * again, an organization role needs the capacity, and nobody else may hold
 * the role in the meantime.
 */
function prepareReopenRolesStatement(db: DatabaseLike, identity: ReinstatableIdentity): StatementLike {
  return db
    .prepare(
      `UPDATE user_roles AS role
          SET revoked_at = NULL
        WHERE role.identity_id = ?
          AND role.revoked_at IS NOT NULL
          AND (
            CASE WHEN role.context_type = 'group' AND role.role_id IN ('role-group_lead', 'role-group_deputy_lead')
              THEN EXISTS (
                SELECT 1 FROM group_memberships seat
                 WHERE seat.identity_id = role.identity_id AND seat.group_id = role.context_id
                   AND seat.member_id IS role.member_id AND seat.left_at IS NULL
                   AND role.revoked_at IN (MAX(seat.joined_at, ?), MAX(role.created_at, ?))
              )
              ELSE role.revoked_at = MAX(role.created_at, ?)
            END
          )
          AND (
            role.context_type IS NOT 'organization'
            OR EXISTS (
              SELECT 1 FROM identity_member_capacities capacity
               WHERE capacity.identity_id = role.identity_id AND capacity.member_id = role.context_id
            )
          )
          AND role.id = (
            SELECT latest.id FROM user_roles latest
             WHERE latest.identity_id = role.identity_id AND latest.role_id = role.role_id
               AND latest.context_type IS role.context_type AND latest.context_id IS role.context_id
               AND latest.member_id IS role.member_id AND latest.revoked_at = role.revoked_at
             ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
          )
          AND NOT EXISTS (
            SELECT 1 FROM user_roles holder
             WHERE holder.revoked_at IS NULL
               AND holder.role_id = role.role_id
               AND holder.context_type IS role.context_type AND holder.context_id IS role.context_id
               AND (
                 (role.single_holder_per_context = 1 AND holder.single_holder_per_context = 1)
                 OR (holder.user_id = role.user_id AND holder.identity_id IS role.identity_id
                     AND holder.member_id IS role.member_id)
               )
          )`,
    )
    .bind(identity.id, identity.ended_at, identity.ended_at, identity.ended_at);
}

/**
 * The reinstatement itself, for the caller's one guarded batch, after the
 * caller's authorization guards. It rechecks eligibility atomically and
 * places the caller's audit row directly after the identity write, so the
 * audit's change guard sees exactly that write.
 */
export function prepareReinstatementStatements(
  db: DatabaseLike,
  input: {
    identity: ReinstatableIdentity;
    context: IdentityNotificationContext;
    seatDepth: number;
    at: string;
    audit: StatementLike | null;
  },
): StatementLike[] {
  const { identity, at } = input;
  return [
    prepareAuthorizationGuard(db, reinstatableIdentityEvidence(identity)),
    db
      .prepare(
        `UPDATE identities SET ended_at = NULL, updated_at = ?
          WHERE id = ? AND ended_at = ? AND blocked_at IS NULL AND updated_at = ?`,
      )
      .bind(at, identity.id, identity.ended_at, identity.updated_at),
    ...(input.audit ? [input.audit] : []),
    ...prepareIdentityEmailOwnershipStatements(db, {
      userId: identity.user_id,
      emailId: identity.email_id,
      identityId: identity.id,
    }),
    ...Array.from({ length: input.seatDepth + 1 }, () => prepareReopenSeatsStatement(db, identity, at)),
    prepareReopenRolesStatement(db, identity),
    prepareIdentityNotification(db, {
      identityId: identity.id,
      userId: identity.user_id,
      context: input.context,
      action: "reinstated",
      at,
    }),
    ...prepareAutomaticGroupEnrollmentForUserStatements(db, identity.user_id, at),
    // Hidden identities may still restore public group terms; inspect them after reconciliation.
    prepareOrganizationIdentityPublication(db, identity.id, at),
  ];
}
