import type { AuthMember, DatabaseLike, EligibleMembership } from "../types";
import { all, first } from "../db/queries";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { normalizeEmail } from "../validation";

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
            AND u.normalized_email = ?
            AND u.active = 1
            AND ${STAFF_ACCESS_CONDITION}`,
    bindings: [userId, normalizedEmail],
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
  member_id: string;
  organization_id: string | null;
  organization_name: string | null;
  membership_category: string;
  is_ec_member: number;
  sort_key: string;
}

export const MEMBER_ELIGIBLE_USER_COLUMNS =
  "id, email, normalized_email, active, member_id, organization_id, organization_name, " +
  "membership_category, is_ec_member, sort_key";

export const MEMBER_ELIGIBLE_USER_SELECT = `
  SELECT u.id, u.email, u.normalized_email, u.active, u.is_ec_member,
         m.id AS member_id, NULL AS organization_id, NULL AS organization_name,
         mca.category_code AS membership_category,
         '0_' || m.created_at AS sort_key
  FROM users u
  JOIN members m ON m.user_id = u.id AND m.status = 'active'
  JOIN member_category_assignments mca ON mca.member_id = m.id

  UNION ALL

  SELECT u.id, u.email, u.normalized_email, u.active, u.is_ec_member,
         m.id AS member_id, m.organization_id, o.name AS organization_name,
         mca.category_code AS membership_category,
         '1_' || r.joined_at AS sort_key
  FROM users u
  JOIN organization_representatives r ON r.user_id = u.id AND r.left_at IS NULL
  JOIN members m ON m.id = r.member_id AND m.status = 'active'
  JOIN member_category_assignments mca ON mca.member_id = m.id
  JOIN organizations o ON o.id = m.organization_id
`;

export function memberSignInAuthorizationEvidence(userId: string, normalizedEmail: string): AuthorizationEvidence {
  return {
    sql: `SELECT 1
          FROM (${MEMBER_ELIGIBLE_USER_SELECT}) eligible
          WHERE eligible.id = ?
            AND eligible.normalized_email = ?
            AND eligible.active = 1
          LIMIT 1`,
    bindings: [userId, normalizedEmail],
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
             AND eligible.member_id = ?
             AND eligible.active = 1
           WHERE session.id = ?
             AND session.user_id = ?
             AND session.revoked_at IS NULL
             AND session.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
           LIMIT 1`,
    bindings: [member.memberId, member.sessionId, member.userId],
  };
}

function toEligibleMembership(row: MemberEligibleUserRow): EligibleMembership {
  return {
    memberId: row.member_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category,
  };
}

export function toAuthMember(rows: MemberEligibleUserRow[], preferredMemberId?: string | null): AuthMember {
  const selected = (preferredMemberId && rows.find((row) => row.member_id === preferredMemberId)) || rows[0];
  return {
    userId: selected.id,
    email: selected.email,
    memberId: selected.member_id,
    organizationId: selected.organization_id,
    membershipCategory: selected.membership_category,
    isEcMember: selected.is_ec_member === 1,
    activeMemberships: rows.map(toEligibleMembership),
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
  preferredMemberId?: string | null,
): Promise<AuthMember | null> {
  const rows = await resolveEligibleMembershipRows(db, userId);
  return rows.length ? toAuthMember(rows, preferredMemberId) : null;
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

export interface IdentityCapacity {
  id: string;
  email: string;
}

export interface IdentityCapacityResolution {
  identity: IdentityCapacity;
  staff: EligibleStaffUser | null;
  member: AuthMember | null;
}

export async function resolveIdentityCapacities(
  db: DatabaseLike,
  userId: string,
): Promise<IdentityCapacityResolution | null> {
  const [staff, member] = await Promise.all([
    findEligibleStaffUserById(db, userId),
    findEligibleMemberById(db, userId),
  ]);
  const email = staff?.email ?? member?.email;
  return email ? { identity: { id: userId, email }, staff, member } : null;
}
