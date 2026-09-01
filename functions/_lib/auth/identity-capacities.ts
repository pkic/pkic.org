import type { AuthMember, DatabaseLike, EligibleIdentity } from "../types";
import { all, first } from "../db/queries";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { normalizeEmail } from "../validation";
import type { SponsorCapacity } from "../../../assets/shared/schemas/sponsor-access";
import { findActiveSponsorCapacitiesByUserId } from "./sponsor-capacity";

export const STAFF_ACCESS_CONDITION = `(
  u.role = 'admin'
  OR EXISTS (
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
  role: string;
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
    `SELECT id, email, role, active FROM users u WHERE u.id = ? AND u.active = 1 AND ${STAFF_ACCESS_CONDITION}`,
    [userId],
  );
}

export async function findEligibleStaffUserByEmail(db: DatabaseLike, email: string): Promise<EligibleStaffUser | null> {
  return first<EligibleStaffUser>(
    db,
    `SELECT id, email, role, active FROM users u WHERE normalized_email = ? AND active = 1 AND ${STAFF_ACCESS_CONDITION}`,
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
         u.active, u.is_ec_member, identity.id AS identity_id,
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
  JOIN members m ON m.user_id = u.id AND m.status = 'active'
  JOIN member_category_assignments mca ON mca.member_id = m.id

  UNION ALL

  SELECT u.id, COALESCE(selected_email.email, u.email) AS email,
         COALESCE(selected_email.normalized_email, u.normalized_email) AS normalized_email,
         u.active, u.is_ec_member, identity.id AS identity_id,
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
             AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
           LIMIT 1`,
    bindings: [member.identityId, member.sessionId, member.userId],
  };
}

function toEligibleIdentity(row: MemberEligibleUserRow): EligibleIdentity {
  return {
    identityId: row.identity_id,
    memberId: row.member_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category,
  };
}

export function toAuthMember(rows: MemberEligibleUserRow[], preferredIdentityId?: string | null): AuthMember {
  const selected = (preferredIdentityId && rows.find((row) => row.identity_id === preferredIdentityId)) || rows[0];
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

export async function resolveEligibleMembershipRows(
  db: DatabaseLike,
  userId: string,
): Promise<MemberEligibleUserRow[]> {
  return all<MemberEligibleUserRow>(
    db,
    `SELECT ${MEMBER_ELIGIBLE_USER_COLUMNS}
     FROM (${MEMBER_ELIGIBLE_USER_SELECT}) combined
     WHERE id = ? AND active = 1
     ORDER BY sort_key ASC`,
    [userId],
  );
}

export async function findEligibleMemberById(
  db: DatabaseLike,
  userId: string,
  preferredIdentityId?: string | null,
): Promise<AuthMember | null> {
  const rows = await resolveEligibleMembershipRows(db, userId);
  return rows.length ? toAuthMember(rows, preferredIdentityId) : null;
}

export async function findEligibleMemberByEmail(db: DatabaseLike, email: string): Promise<AuthMember | null> {
  const row = await first<MemberEligibleUserRow>(
    db,
    `SELECT ${MEMBER_ELIGIBLE_USER_COLUMNS}
     FROM (${MEMBER_ELIGIBLE_USER_SELECT}) combined
     WHERE normalized_email = ? AND active = 1
     ORDER BY sort_key ASC`,
    [normalizeEmail(email)],
  );
  return row ? toAuthMember([row]) : null;
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

export interface IdentityCapacityResolution {
  identity: IdentityCapacity;
  staff: EligibleStaffUser | null;
  member: AuthMember | null;
  sponsors: SponsorCapacity[];
  pendingIdentityCount: number;
}

export async function resolveIdentityCapacities(
  db: DatabaseLike,
  userId: string,
): Promise<IdentityCapacityResolution | null> {
  const [identity, staff, member, sponsors, pendingIdentityCount] = await Promise.all([
    first<{ id: string; email: string }>(db, "SELECT id, email FROM users WHERE id = ? AND active = 1", [userId]),
    findEligibleStaffUserById(db, userId),
    findEligibleMemberById(db, userId),
    findActiveSponsorCapacitiesByUserId(db, userId),
    countPendingIdentitiesForUser(db, userId),
  ]);
  return identity && (staff || member || sponsors.length > 0 || pendingIdentityCount > 0)
    ? { identity, staff, member, sponsors, pendingIdentityCount }
    : null;
}
