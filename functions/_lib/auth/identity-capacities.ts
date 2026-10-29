import { MAX_ACTING_IDENTITIES, SESSION_ACTING_IDENTITY_ORDER_SQL } from "./session-acting-identities";
import { sessionEmailSignInAllowedSql } from "./email-sign-in-policy";
import { hasEventParticipation } from "./event-participation";
import type { AuthMember, DatabaseLike, EligibleIdentity } from "../types";
import { all, first } from "../db/queries";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { normalizeEmail } from "../validation";
import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import { findActiveSponsorCapacitiesByUserId } from "./sponsor-capacity";
import { findActingIdentitiesForUser } from "./session-acting-identities";
import {
  resolveSessionActingIdentityId,
  type SessionActingIdentity,
} from "../../../assets/shared/session-acting-identity";
import { executiveCouncilSeatSql } from "./executive-council";
import { activeOrganizationMemberRepresentationPredicate } from "../services/membership/capacity-query";
import { sqlValue, type SqlId } from "../db/sql-value";
import { batchRows } from "../db/pagination";
import { actingIdentitiesSelection, decodeActingIdentities } from "./session-acting-identities";
import type { D1StatementResult } from "../types";

export const STAFF_ACCESS_CONDITION = `(
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = u.id
      AND ur.revoked_at IS NULL
      AND (ur.expires_at IS NULL OR ur.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )
  OR EXISTS (
    SELECT 1 FROM permission_grants pg
    WHERE pg.user_id = u.id
      AND pg.revoked_at IS NULL
      AND (pg.expires_at IS NULL OR pg.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )
)`;

export interface EligibleStaffUser {
  id: string;
  email: string;
  active: number;
}

export function staffSignInAuthorizationEvidence(userId: string, normalizedEmail: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1
          FROM users u
          WHERE u.id = ?
            AND u.active = 1
            AND (
              u.normalized_email = ?
              OR EXISTS (
                SELECT 1 FROM user_emails ue
                 WHERE ue.user_id = u.id
                   AND ue.normalized_email = ?
                   AND ue.verified_at IS NOT NULL
              )
            )
            AND ${STAFF_ACCESS_CONDITION}`,
    bindings: [userId, normalizedEmail, normalizedEmail],
  };
}

export async function findEligibleStaffUserById(db: DatabaseLike, userId: string): Promise<EligibleStaffUser | null> {
  return first<EligibleStaffUser>(
    db,
    `SELECT id, email, active FROM users u WHERE u.id = ? AND u.active = 1 AND ${STAFF_ACCESS_CONDITION}`,
    [userId],
  );
}

export async function findEligibleStaffUserByEmail(db: DatabaseLike, email: string): Promise<EligibleStaffUser | null> {
  return first<EligibleStaffUser>(
    db,
    `SELECT id, email, active FROM users u WHERE normalized_email = ? AND active = 1 AND ${STAFF_ACCESS_CONDITION}`,
    [normalizeEmail(email)],
  );
}

export interface MemberEligibleUserRow {
  id: string;
  email: string;
  normalized_email: string;
  active: number;
  identity_id: string;
  member_id: string;
  organization_id: string | null;
  organization_name: string | null;
  membership_category: string;
  is_ec_member: number;
  sort_key: string;
}

export const MEMBER_ELIGIBLE_USER_COLUMNS =
  "id, email, normalized_email, active, identity_id, member_id, organization_id, organization_name, " +
  "membership_category, is_ec_member, sort_key";

export const MEMBER_ELIGIBLE_USER_SELECT = `
  SELECT u.id, COALESCE(selected_email.email, u.email) AS email,
         COALESCE(selected_email.normalized_email, u.normalized_email) AS normalized_email,
         u.active, ${executiveCouncilSeatSql("u.id")} AS is_ec_member, identity.id AS identity_id,
         m.id AS member_id, NULL AS organization_id, NULL AS organization_name,
         mca.category_code AS membership_category,
         '0_' || identity.started_at AS sort_key
  FROM users u
  JOIN identities identity
    ON identity.user_id = u.id
   AND identity.organization_id IS NULL
   AND identity.started_at IS NOT NULL
   AND identity.ended_at IS NULL
   AND identity.blocked_at IS NULL
  LEFT JOIN user_emails selected_email
    ON selected_email.id = identity.email_id
   AND selected_email.user_id = u.id
   AND selected_email.verified_at IS NOT NULL
  JOIN members m ON m.identity_id = identity.id AND m.member_type = 'individual' AND m.status = 'active'
  JOIN member_category_assignments mca ON mca.member_id = m.id
  WHERE NOT ${activeOrganizationMemberRepresentationPredicate("u.id")}

  UNION ALL

  SELECT u.id, COALESCE(selected_email.email, u.email) AS email,
         COALESCE(selected_email.normalized_email, u.normalized_email) AS normalized_email,
         u.active, ${executiveCouncilSeatSql("u.id")} AS is_ec_member, identity.id AS identity_id,
         m.id AS member_id, m.organization_id, o.name AS organization_name,
         mca.category_code AS membership_category,
         '1_' || identity.started_at AS sort_key
  FROM users u
  JOIN identities identity
    ON identity.user_id = u.id
   AND identity.organization_id IS NOT NULL
   AND identity.started_at IS NOT NULL
   AND identity.ended_at IS NULL
   AND identity.blocked_at IS NULL
  LEFT JOIN user_emails selected_email
    ON selected_email.id = identity.email_id
   AND selected_email.user_id = u.id
   AND selected_email.verified_at IS NOT NULL
  JOIN members m ON m.organization_id = identity.organization_id AND m.status = 'active'
  JOIN member_category_assignments mca ON mca.member_id = m.id
  JOIN organizations o ON o.id = m.organization_id
`;

export function memberSignInAuthorizationEvidence(userId: string, normalizedEmail: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1
          FROM (${MEMBER_ELIGIBLE_USER_SELECT}) eligible
          JOIN users sign_in_user ON sign_in_user.id = eligible.id
          WHERE eligible.id = ?
            AND eligible.active = 1
            AND (
              sign_in_user.normalized_email = ?
              OR EXISTS (
                SELECT 1 FROM user_emails ue
                 WHERE ue.user_id = sign_in_user.id
                   AND ue.normalized_email = ?
                   AND ue.verified_at IS NOT NULL
              )
            )
          LIMIT 1`,
    bindings: [userId, normalizedEmail, normalizedEmail],
  };
}

/** Rechecks that the exact session behind a current-user mutation is live and its user still active; no capacity is implied. */
export function userSessionAuthorizationEvidence(userId: string, sessionId: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1
            FROM sessions session
            JOIN users u ON u.id = session.user_id AND u.active = 1
           WHERE session.id = ?
             AND session.user_id = ?
             AND session.revoked_at IS NULL
             AND ${sessionEmailSignInAllowedSql("session.id", "session.user_id")}
             AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
           LIMIT 1`,
    bindings: [sessionId, userId],
  };
}

/** Rechecks the exact live session and selected member capacity used by a current-user mutation. */
export function memberSessionAuthorizationEvidence(member: AuthMember): AuthorizationEvidence {
  if (!member.sessionId) return { sql: "SELECT 1 WHERE 0", bindings: [] };
  return {
    sql: `SELECT 1
            FROM sessions session
            JOIN (${MEMBER_ELIGIBLE_USER_SELECT}) eligible
              ON eligible.id = session.user_id
             AND eligible.identity_id = ?
             AND eligible.active = 1
           WHERE session.id = ?
             AND session.user_id = ?
             AND session.revoked_at IS NULL
             AND ${sessionEmailSignInAllowedSql("session.id", "session.user_id")}
             AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
           LIMIT 1`,
    bindings: [member.identityId, member.sessionId, member.userId],
  };
}

export function toEligibleIdentity(row: MemberEligibleUserRow): EligibleIdentity {
  return {
    identityId: row.identity_id,
    memberId: row.member_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category,
  };
}

/**
 * The membership context of exactly the identity a session acts as. An
 * identity that holds no membership, or no chosen identity at all, has no
 * member context: membership never falls back to another identity.
 */
export function selectActingMember(
  rows: readonly MemberEligibleUserRow[],
  actingIdentityId: string | null,
): AuthMember | null {
  const selected = actingIdentityId ? rows.find((row) => row.identity_id === actingIdentityId) : undefined;
  if (!selected) return null;
  return {
    userId: selected.id,
    identityId: selected.identity_id,
    email: selected.email,
    memberId: selected.member_id,
    organizationId: selected.organization_id,
    membershipCategory: selected.membership_category,
    isEcMember: selected.is_ec_member === 1,
    activeIdentities: rows.map(toEligibleIdentity),
  };
}

/** Every membership the person can act through, whichever identity the session acts as. */
export async function resolveEligibleMembershipRows(
  db: DatabaseLike,
  userId: string,
): Promise<MemberEligibleUserRow[]> {
  const read = eligibleMembershipSelection(userId);
  return all<MemberEligibleUserRow>(db, read.sql, read.bindings);
}

export function eligibleMembershipSelection(userId: SqlId) {
  const user = sqlValue(userId);
  return {
    sql: `SELECT ${MEMBER_ELIGIBLE_USER_COLUMNS}
     FROM (${MEMBER_ELIGIBLE_USER_SELECT}) combined
     WHERE id = ${user.sql} AND active = 1
     ORDER BY sort_key ASC`,
    bindings: user.bindings,
  };
}

/** Project the session's exact member and acting identities inside its existing write batch. */
export function prepareEligibleMemberRead(db: DatabaseLike, userId: SqlId, identityId: string) {
  const memberships = eligibleMembershipSelection(userId);
  const identities = actingIdentitiesSelection(userId);
  return {
    statements: [
      db.prepare(memberships.sql).bind(...memberships.bindings),
      db.prepare(identities.sql).bind(...identities.bindings),
    ],
    decode: (results: D1StatementResult[]) =>
      selectActingMember(
        batchRows<MemberEligibleUserRow>(results[0]),
        resolveSessionActingIdentityId(decodeActingIdentities(results[1]), identityId),
      ),
  };
}

/**
 * The member context a session for this person would have: the membership
 * of the identity it acts as, resolved by the shared acting-identity rule
 * from the session's selection.
 */
export async function findEligibleMemberById(
  db: DatabaseLike,
  userId: string,
  selectedIdentityId?: string | null,
): Promise<AuthMember | null> {
  const [rows, actingIdentities] = await Promise.all([
    resolveEligibleMembershipRows(db, userId),
    findActingIdentitiesForUser(db, userId),
  ]);
  return selectActingMember(rows, resolveSessionActingIdentityId(actingIdentities, selectedIdentityId));
}

export async function countPendingIdentitiesForUser(db: DatabaseLike, userId: string): Promise<number> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
       FROM identities
      WHERE user_id = ?
        AND started_at IS NULL
        AND ended_at IS NULL
        AND blocked_at IS NULL`,
    [userId],
  );
  return Number(row?.total ?? 0);
}

export function pendingIdentitySignInAuthorizationEvidence(
  userId: string,
  normalizedEmail: string,
): AuthorizationEvidence {
  return {
    sql: `SELECT 1
            FROM users user
           WHERE user.id = ?
             AND user.active = 1
             AND (
               user.normalized_email = ?
               OR EXISTS (
                 SELECT 1 FROM user_emails email
                  WHERE email.user_id = user.id
                    AND email.normalized_email = ?
                    AND email.verified_at IS NOT NULL
               )
             )
             AND EXISTS (
               SELECT 1 FROM identities identity
                WHERE identity.user_id = user.id
                  AND identity.started_at IS NULL
                  AND identity.ended_at IS NULL
                  AND identity.blocked_at IS NULL
             )`,
    bindings: [userId, normalizedEmail, normalizedEmail],
  };
}

export interface IdentityCapacity {
  id: string;
  email: string;
}

export function activeIdentityPredicate(userAlias: string): string {
  return `EXISTS (
    SELECT 1 FROM identities identity
     WHERE identity.user_id = ${userAlias}.id
       AND identity.started_at IS NOT NULL
       AND identity.ended_at IS NULL
       AND identity.blocked_at IS NULL
  )`;
}

/** Any active identity, personal or organization, permits account access without granting membership. */
export async function hasActiveIdentity(db: DatabaseLike, userId: string): Promise<boolean> {
  return (
    (await first<{ id: string }>(
      db,
      `SELECT user.id FROM users user
       WHERE user.id = ? AND user.active = 1
         AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL
         AND ${activeIdentityPredicate("user")}`,
      [userId],
    )) !== null
  );
}

/** Rechecks that the canonical user is still active and owns the proved sign-in address; no capacity is implied. */
export function activeUserSignInAuthorizationEvidence(userId: string, normalizedEmail: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM users user
       WHERE user.id = ? AND user.active = 1
         AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL
         AND (user.normalized_email = ? OR EXISTS (
           SELECT 1 FROM user_emails address
            WHERE address.user_id = user.id AND address.normalized_email = ? AND address.verified_at IS NOT NULL
         ))`,
    bindings: [userId, normalizedEmail, normalizedEmail],
  };
}

/** Rechecks the live affiliation, canonical user, and proved sign-in address in the session batch. */
export function identitySignInAuthorizationEvidence(userId: string, normalizedEmail: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1 FROM users user
       WHERE user.id = ? AND user.active = 1
         AND user.pii_redacted_at IS NULL AND user.merged_into_user_id IS NULL
         AND (user.normalized_email = ? OR EXISTS (
           SELECT 1 FROM user_emails address
            WHERE address.user_id = user.id AND address.normalized_email = ? AND address.verified_at IS NOT NULL
         ))
         AND ${activeIdentityPredicate("user")}`,
    bindings: [userId, normalizedEmail, normalizedEmail],
  };
}

export interface IdentityCapacityResolution {
  identity: IdentityCapacity;
  staff: EligibleStaffUser | null;
  /** Every membership the person holds through any identity; sign-in eligibility, not session context. */
  memberships: MemberEligibleUserRow[];
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
  eventParticipation: boolean;
  hasActiveIdentity: boolean;
  actingIdentities: SessionActingIdentity[];
}

export async function resolveIdentityCapacities(
  db: DatabaseLike,
  userId: string,
): Promise<IdentityCapacityResolution | null> {
  const [
    identity,
    staff,
    memberships,
    sponsors,
    pendingIdentityCount,
    eventParticipation,
    affiliation,
    actingIdentities,
  ] = await Promise.all([
    first<{ id: string; email: string }>(
      db,
      "SELECT id, email FROM users WHERE id = ? AND active = 1 AND pii_redacted_at IS NULL AND merged_into_user_id IS NULL",
      [userId],
    ),
    findEligibleStaffUserById(db, userId),
    resolveEligibleMembershipRows(db, userId),
    findActiveSponsorCapacitiesByUserId(db, userId),
    countPendingIdentitiesForUser(db, userId),
    hasEventParticipation(db, userId),
    hasActiveIdentity(db, userId),
    findActingIdentitiesForUser(db, userId),
  ]);
  return identity
    ? {
        identity,
        staff,
        memberships,
        sponsors,
        pendingIdentityCount,
        eventParticipation,
        hasActiveIdentity: affiliation,
        actingIdentities,
      }
    : null;
}

/** Canonical live acting identity choice, shared by atomic audit and membership selection. */
export function userSessionActingIdentitySelection(userId: string, selectedIdentityId?: string) {
  return {
    sql: `WITH acting AS MATERIALIZED(SELECT identity.id FROM identities identity LEFT JOIN organizations organization ON organization.id=identity.organization_id WHERE identity.user_id=? AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL ORDER BY ${SESSION_ACTING_IDENTITY_ORDER_SQL} LIMIT ${MAX_ACTING_IDENTITIES}) SELECT COALESCE((SELECT id FROM acting WHERE id=?),(SELECT MIN(id) FROM acting HAVING COUNT(*)=1))`,
    bindings: [userId, selectedIdentityId ?? null],
  };
}
/** The same live acting identity/member choice used by the session decoder, available inside a command guard. */
export function userSessionMemberSelection(userId: string, selectedIdentityId?: string) {
  const identity = userSessionActingIdentitySelection(userId, selectedIdentityId);
  return {
    sql: `SELECT eligible.member_id FROM (${MEMBER_ELIGIBLE_USER_SELECT}) eligible WHERE eligible.id=? AND eligible.active=1 AND eligible.identity_id=(${identity.sql}) ORDER BY eligible.sort_key LIMIT 1`,
    bindings: [userId, ...identity.bindings],
  };
}
