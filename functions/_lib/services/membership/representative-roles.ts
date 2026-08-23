/**
 * Organization representative role grants (primary contact, secondary
 * contact, voting delegate) — ordinary `user_roles` rows scoped
 * `context_type='organization'`, `context_id=members.id`, reusing the
 * existing roles/user_roles RBAC system (consolidated migration 0035) instead of a
 * second, bespoke role table.
 *
 * Each of the three is a singleton per organization
 * (`uq_user_roles_single_holder_per_context`, consolidated migration 0035): assigning a
 * new holder revokes the previous active grant in the same `db.batch()`.
 */
import { all, first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { uuid } from "../../utils/ids";
import { AppError } from "../../errors";
import { isActiveRepresentative } from "./representatives";
import type { DatabaseLike, StatementLike } from "../../types";
import {
  REPRESENTATIVE_ROLE_IDS,
  isRepresentativeRoleId,
  type RepresentativeRoleId,
} from "../../../../assets/shared/schemas/representative-roles";

export { REPRESENTATIVE_ROLE_IDS, isRepresentativeRoleId };
export type { RepresentativeRoleId };

/**
 * Builds [revoke-previous-holder, insert-new-grant] statements for one of
 * the three singleton representative roles, without doing a preflight read
 * of `organization_representatives` — for callers that are themselves
 * inserting that exact representative row earlier in the same `db.batch()`.
 * The migration-level trigger `trg_user_roles_representative_requires_active`
 * is the final execution-time guard for every caller, including this path.
 */
export function buildAssignRepresentativeRoleStatementsForNewRepresentative(
  db: DatabaseLike,
  input: {
    memberId: string;
    userId: string;
    roleId: RepresentativeRoleId;
    grantedByUserId?: string | null;
    assignmentId?: string;
    now?: string;
  },
): StatementLike[] {
  const now = input.now ?? nowIso();
  return [
    db
      .prepare(
        `UPDATE user_roles SET revoked_at = ?
         WHERE context_type = 'organization' AND context_id = ? AND role_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, input.memberId, input.roleId),
    db
      .prepare(
        `INSERT INTO user_roles
           (id, user_id, role_id, context_type, context_id, granted_by_user_id, single_holder_per_context, created_at)
         VALUES (?, ?, ?, 'organization', ?, ?, 1, ?)`,
      )
      .bind(
        input.assignmentId ?? uuid(),
        input.userId,
        input.roleId,
        input.memberId,
        input.grantedByUserId ?? null,
        now,
      ),
  ];
}

/**
 * Builds [revoke-previous-holder?, insert-new-grant] statements for one of
 * the three singleton representative roles. Throws before building any
 * statement if `(userId, memberId)` has no active `organization_representatives`
 * row — the service-layer invariant that replaces the composite FK a
 * bespoke role table would have had (see consolidated migration 0035's header).
 * The migration-level trigger is also required because this preflight can
 * become stale before the returned batch executes.
 *
 * Caller is responsible for executing the returned statements in the same
 * `db.batch()` as any other write in the same operation (e.g. approval
 * provisioning) — this function never executes anything itself.
 */
export async function buildAssignRepresentativeRoleStatements(
  db: DatabaseLike,
  input: {
    memberId: string;
    userId: string;
    roleId: RepresentativeRoleId;
    grantedByUserId?: string | null;
    assignmentId?: string;
    now?: string;
  },
): Promise<StatementLike[]> {
  const isRepresentative = await isActiveRepresentative(db, input.memberId, input.userId);
  if (!isRepresentative) {
    throw new AppError(
      422,
      "NOT_ACTIVE_REPRESENTATIVE",
      "Only an active representative of this organization can hold this role",
    );
  }
  return buildAssignRepresentativeRoleStatementsForNewRepresentative(db, input);
}

/**
 * Revokes the active grant of `roleId` for `memberId`. When `userId` is
 * given, only that user's grant is revoked (a no-op UPDATE if that user
 * isn't the current holder) — required whenever the caller is reacting to
 * one specific representative leaving, since these roles are singletons
 * per-organization but the removed representative may not be the current
 * holder at all. Omit `userId` only when the caller genuinely means "clear
 * whoever holds this role" (e.g. an explicit admin unassign action).
 */
export function buildRevokeRepresentativeRoleStatement(
  db: DatabaseLike,
  input: { memberId: string; roleId: RepresentativeRoleId; userId?: string; now?: string },
): StatementLike {
  const now = input.now ?? nowIso();
  if (input.userId) {
    return db
      .prepare(
        `UPDATE user_roles SET revoked_at = ?
         WHERE context_type = 'organization' AND context_id = ? AND role_id = ? AND user_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, input.memberId, input.roleId, input.userId);
  }
  return db
    .prepare(
      `UPDATE user_roles SET revoked_at = ?
       WHERE context_type = 'organization' AND context_id = ? AND role_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, input.memberId, input.roleId);
}

interface RoleHolderRow {
  user_id: string;
}

/**
 * The canonical active-holder predicate shared by role resolution and read-model
 * projections. Keep the role, user, and representative aliases explicit because
 * callers use this in both ordinary queries and derived-table projections.
 */
export function representativeRoleActivePredicate(
  roleAlias = "ur",
  userAlias = "u",
  representativeAlias = "rep",
  nowPlaceholder = "?",
): string {
  return `${roleAlias}.revoked_at IS NULL
       AND ${userAlias}.active = 1
       AND ${representativeAlias}.left_at IS NULL
       AND (${roleAlias}.expires_at IS NULL OR datetime(${roleAlias}.expires_at) > datetime(${nowPlaceholder}))`;
}

/**
 * A one-row-per-organization projection for the active primary contact.
 * The current time remains a bound parameter.
 */
export function primaryContactProjection(): string {
  return `(SELECT ur.context_id AS member_id, ur.user_id,
          u.first_name, u.last_name, u.email
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     JOIN organization_representatives rep
       ON rep.member_id = ur.context_id AND rep.user_id = ur.user_id
    WHERE ur.context_type = 'organization' AND ur.role_id = '${REPRESENTATIVE_ROLE_IDS.primaryContact}'
      AND ${representativeRoleActivePredicate()}) AS primary_contact`;
}

/** The current active holder of a singleton representative role for an organization, or null. */
export async function resolveRepresentativeRoleHolder(
  db: DatabaseLike,
  memberId: string,
  roleId: RepresentativeRoleId,
): Promise<string | null> {
  const row = await first<RoleHolderRow>(
    db,
    `SELECT ur.user_id
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     JOIN organization_representatives rep
       ON rep.member_id = ur.context_id AND rep.user_id = ur.user_id
     WHERE ur.context_type = 'organization' AND ur.context_id = ? AND ur.role_id = ?
       AND ${representativeRoleActivePredicate()}
     LIMIT 1`,
    [memberId, roleId, nowIso()],
  );
  return row?.user_id ?? null;
}

export interface RepresentativeRoleHolders {
  primaryContactUserId: string | null;
  secondaryContactUserId: string | null;
  votingDelegateUserId: string | null;
}

export async function resolveRepresentativeRoleHolders(
  db: DatabaseLike,
  memberId: string,
): Promise<RepresentativeRoleHolders> {
  const rows = await all<{ role_id: string; user_id: string }>(
    db,
    `SELECT ur.role_id, ur.user_id
     FROM user_roles ur
     JOIN users u ON u.id = ur.user_id
     JOIN organization_representatives rep
       ON rep.member_id = ur.context_id AND rep.user_id = ur.user_id
     WHERE ur.context_type = 'organization' AND ur.context_id = ?
       AND ${representativeRoleActivePredicate()}
       AND ur.role_id IN (?, ?, ?)`,
    [
      memberId,
      nowIso(),
      REPRESENTATIVE_ROLE_IDS.primaryContact,
      REPRESENTATIVE_ROLE_IDS.secondaryContact,
      REPRESENTATIVE_ROLE_IDS.votingDelegate,
    ],
  );
  const byRole = new Map(rows.map((row) => [row.role_id, row.user_id]));
  return {
    primaryContactUserId: byRole.get(REPRESENTATIVE_ROLE_IDS.primaryContact) ?? null,
    secondaryContactUserId: byRole.get(REPRESENTATIVE_ROLE_IDS.secondaryContact) ?? null,
    votingDelegateUserId: byRole.get(REPRESENTATIVE_ROLE_IDS.votingDelegate) ?? null,
  };
}

/**
 * Whether `actorUserId` is an active primary or secondary contact for at
 * least one active organization that `targetUserId` currently represents.
 * This is the canonical cross-user identity-management boundary for member
 * self-service: ordinary coworkers and free-text organization names confer
 * no authority.
 */
export async function isOrganizationContactForRepresentative(
  db: DatabaseLike,
  actorUserId: string,
  targetUserId: string,
): Promise<boolean> {
  const row = await first<{ allowed: number }>(
    db,
    `SELECT 1 AS allowed
       FROM user_roles ur
       JOIN users actor ON actor.id = ur.user_id
       JOIN organization_representatives actor_rep
         ON actor_rep.member_id = ur.context_id AND actor_rep.user_id = ur.user_id
       JOIN members m
         ON m.id = ur.context_id AND m.status = 'active' AND m.organization_id IS NOT NULL
       JOIN organization_representatives target_rep
         ON target_rep.member_id = m.id AND target_rep.user_id = ? AND target_rep.left_at IS NULL
      WHERE ur.user_id = ?
        AND ur.context_type = 'organization'
        AND ur.role_id IN (?, ?)
        AND ${representativeRoleActivePredicate("ur", "actor", "actor_rep")}
      LIMIT 1`,
    [
      targetUserId,
      actorUserId,
      REPRESENTATIVE_ROLE_IDS.primaryContact,
      REPRESENTATIVE_ROLE_IDS.secondaryContact,
      nowIso(),
    ],
  );
  return row?.allowed === 1;
}
