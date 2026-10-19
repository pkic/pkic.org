import { sessionEmailSignInAllowedSql } from "./email-sign-in-policy";
import type { DatabaseLike } from "../types";
import { first } from "../db/queries";
import { AppError } from "../errors";
import { recordAuditActingIdentity } from "../services/audit-actor";
import { resolveSessionActingIdentityId } from "../../../assets/shared/session-acting-identity";
import { hasEventParticipation } from "./event-participation";
import {
  findEligibleStaffUserById,
  resolveEligibleMembershipRows,
  selectActingMember,
  countPendingIdentitiesForUser,
  hasActiveIdentity,
} from "./identity-capacities";
import { findActingIdentitiesForUser } from "./session-acting-identities";
import { findActiveSponsorCapacitiesByUserId } from "./sponsor-capacity";
import { assertSessionActive, fetchSessionRow, type SessionTableConfig } from "./session-engine";
import {
  DEFAULT_USER_SESSION_IDLE_TTL_HOURS,
  sessionIdleExpiresAt,
  STAFF_SESSION_IDLE_TTL_HOURS,
} from "./session-policy";
import {
  createStaffSessionActor,
  staffSessionActor,
  userStaffExpiresAt,
  type UserSessionResult,
} from "./user-session-result";
import type { UserSessionTokenClaims } from "./user-session-token";
import type { UserSessionLiveData } from "./user-session-live-data";

export const USER_SESSIONS: SessionTableConfig = { table: "sessions", subjectColumn: "user_id" };

function activityAtOrCreatedAt(activityAt: number | undefined, createdAt: string): number {
  if (activityAt !== undefined) return activityAt;
  const createdAtSeconds = Math.floor(new Date(createdAt).getTime() / 1000);
  if (!Number.isSafeInteger(createdAtSeconds)) {
    throw new AppError(401, "AUTH_INVALID", "Invalid user session activity timestamp");
  }
  return createdAtSeconds;
}

function assertActivityActive(idleExpiresAt: string): void {
  if (new Date(idleExpiresAt).getTime() <= Date.now()) {
    throw new AppError(401, "AUTH_EXPIRED", "User session expired due to inactivity");
  }
}

export async function findActiveIdentity(
  db: DatabaseLike,
  userId: string,
): Promise<{ id: string; email: string; normalized_email: string } | null> {
  return first(
    db,
    `SELECT id, email, normalized_email FROM users
      WHERE id = ? AND active = 1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL`,
    [userId],
  );
}

/** Resolve identity, capacities, and acting identity from one session row and live D1 state. */
export async function resolveUserSessionClaims(
  db: DatabaseLike,
  claims: UserSessionTokenClaims,
  liveData?: UserSessionLiveData,
  recordAudit = true,
): Promise<UserSessionResult> {
  if (claims.exp <= Math.floor(Date.now() / 1000)) throw new AppError(401, "AUTH_EXPIRED", "User session expired");
  const row = assertSessionActive(
    liveData ? liveData.row : await fetchSessionRow(db, USER_SESSIONS, claims.sid, claims.sub),
    "user",
  );
  if (row.id !== claims.sid || row.subjectId !== claims.sub)
    throw new AppError(401, "AUTH_INVALID", "Invalid user session token");
  if (
    !liveData &&
    !(await first(db, `SELECT 1 WHERE ${sessionEmailSignInAllowedSql("?", "?")}`, [claims.sid, claims.sub]))
  ) {
    throw new AppError(401, "AUTH_INVALID", "This sign-in address no longer permits account access");
  }
  const lastActivityAt = activityAtOrCreatedAt(claims.lastActivityAt, row.createdAt);
  const idleExpiresAt = sessionIdleExpiresAt(lastActivityAt, row.expiresAt, DEFAULT_USER_SESSION_IDLE_TTL_HOURS);
  assertActivityActive(idleExpiresAt);
  const [
    identity,
    staff,
    memberships,
    sponsors,
    pendingIdentityCount,
    eventParticipation,
    affiliation,
    actingIdentities,
  ] = liveData
    ? ([
        liveData.identity,
        liveData.staff,
        liveData.memberships,
        liveData.sponsors,
        liveData.pendingIdentityCount,
        liveData.eventParticipation,
        liveData.affiliation,
        liveData.actingIdentities,
      ] as const)
    : await Promise.all([
        findActiveIdentity(db, claims.sub),
        findEligibleStaffUserById(db, claims.sub),
        resolveEligibleMembershipRows(db, claims.sub),
        findActiveSponsorCapacitiesByUserId(db, claims.sub),
        countPendingIdentitiesForUser(db, claims.sub),
        hasEventParticipation(db, claims.sub),
        hasActiveIdentity(db, claims.sub),
        findActingIdentitiesForUser(db, claims.sub),
      ]);
  // An active user holds a session even with no capacity; what the session reaches is decided by each route's own guard.
  if (!identity) throw new AppError(401, "AUTH_INVALID", "This user is no longer active");
  // The selection is honored only while that identity is still active, and
  // the session's member context is exactly that identity's membership.
  const actingIdentityId = resolveSessionActingIdentityId(actingIdentities, claims.iid);
  const member = selectActingMember(memberships, actingIdentityId);
  const elevatedStaffExpiry = userStaffExpiresAt(row.createdAt, row.expiresAt);
  const staffLastActivityAt = activityAtOrCreatedAt(claims.staffLastActivityAt, row.createdAt);
  const staffIdleExpiresAt = sessionIdleExpiresAt(
    staffLastActivityAt,
    elevatedStaffExpiry,
    STAFF_SESSION_IDLE_TTL_HOURS,
  );
  const staffActive = new Date(staffIdleExpiresAt).getTime() > Date.now();
  if (staff && !staffActive) {
    throw new AppError(401, "AUTH_EXPIRED", "Your session expired. Sign in again.");
  }
  const staffActor =
    staff && staffActive
      ? liveData
        ? staffSessionActor(staff, row.id, elevatedStaffExpiry, member?.memberId ?? null, liveData.grants, claims.state)
        : await createStaffSessionActor(db, staff, row.id, elevatedStaffExpiry, member?.memberId ?? null, claims.state)
      : null;
  if (recordAudit) recordAuditActingIdentity(identity.id, actingIdentityId);
  return {
    identity: { id: identity.id, email: identity.email },
    sessionId: row.id,
    expiresAt: row.expiresAt,
    idleExpiresAt,
    ...(staffActor ? { staff: staffActor } : {}),
    ...(staffActor ? { staffIdleExpiresAt } : {}),
    ...(member ? { member: { ...member, sessionId: row.id, expiresAt: row.expiresAt } } : {}),
    sponsors,
    pendingIdentityCount,
    eventParticipation,
    hasActiveIdentity: affiliation,
    actingIdentities,
    actingIdentityId,
  };
}
