/**
 * Organization representative role grants (primary contact, secondary
 * contact, voting delegate) — ordinary `user_roles` rows scoped
 * `context_type='organization'`, `context_id=members.id`, reusing the
 * existing roles/user_roles RBAC system (migration 0038) instead of a
 * second, bespoke role table.
 *
 * Each of the three is a singleton per organization
 * (`uq_user_roles_single_holder_per_context`, migration 0038): assigning a
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
 * the three singleton representative roles, without verifying the active
 * `organization_representatives` invariant — for callers that are
 * themselves inserting that exact representative row earlier in the same
 * `db.batch()` (so the invariant holds by construction; a DB read couldn't
 * see the uncommitted insert anyway). Any other caller must use
 * `buildAssignRepresentativeRoleStatements` instead, which verifies it.
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
 * bespoke role table would have had (see migration 0037's header).
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

/** The current active holder of a singleton representative role for an organization, or null. */
export async function resolveRepresentativeRoleHolder(
  db: DatabaseLike,
  memberId: string,
  roleId: RepresentativeRoleId,
): Promise<string | null> {
  const row = await first<RoleHolderRow>(
    db,
    `SELECT user_id FROM user_roles
     WHERE context_type = 'organization' AND context_id = ? AND role_id = ? AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)
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
    `SELECT role_id, user_id FROM user_roles
     WHERE context_type = 'organization' AND context_id = ? AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)
       AND role_id IN (?, ?, ?)`,
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
