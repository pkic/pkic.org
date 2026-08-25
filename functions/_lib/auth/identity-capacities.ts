import type { AuthMember, DatabaseLike, StatementLike, UserBackedAuthAdmin } from "../types";
import { AppError } from "../errors";
import { findEligibleStaffUserById, type EligibleStaffUser } from "./admin";
import { createUserBackedAuthAdmin } from "./admin-identity";
import { findEligibleMemberById } from "./member";
import { AUTH_SCOPES } from "./scopes";
import { prepareSessionRow } from "./session-engine";
import { resolveMemberSessionTtlHours } from "./session-policy";

const USER_SESSIONS = { table: "sessions", subjectColumn: "user_id" } as const;
const ADMIN_SESSION_TTL_HOURS = 8;

export interface IdentityCapacity {
  id: string;
  email: string;
}

export interface IdentityCapacityResolution {
  identity: IdentityCapacity;
  staff: EligibleStaffUser | null;
  member: AuthMember | null;
}

export interface PreparedCapacitySession<T> {
  value: T;
  sessionId: string;
  expiresAt: string;
  statement: StatementLike;
}

export interface PreparedIdentityCapacitySessions {
  identity: IdentityCapacity;
  expiresAt: string;
  admin?: PreparedCapacitySession<UserBackedAuthAdmin>;
  member?: PreparedCapacitySession<AuthMember>;
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

function toAdmin(staff: EligibleStaffUser, sessionId: string, expiresAt: string): UserBackedAuthAdmin {
  return createUserBackedAuthAdmin({
    id: staff.id,
    email: staff.email,
    role: staff.role,
    scopes: staff.role === "admin" ? [...AUTH_SCOPES] : [],
    sessionId,
    expiresAt,
  });
}

export async function prepareIdentityCapacitySessions(
  db: DatabaseLike,
  resolved: IdentityCapacityResolution,
  memberSessionTtlHours: string | undefined,
): Promise<PreparedIdentityCapacitySessions> {
  const [preparedAdmin, preparedMember] = await Promise.all([
    resolved.staff
      ? prepareSessionRow(db, USER_SESSIONS, resolved.identity.id, ADMIN_SESSION_TTL_HOURS)
      : Promise.resolve(null),
    resolved.member
      ? prepareSessionRow(db, USER_SESSIONS, resolved.identity.id, resolveMemberSessionTtlHours(memberSessionTtlHours))
      : Promise.resolve(null),
  ]);
  const expiresAt = [preparedAdmin?.expiresAt, preparedMember?.expiresAt]
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  if (!expiresAt) throw new AppError(500, "SESSION_ISSUANCE_FAILED", "No identity capacity session was prepared");

  return {
    identity: resolved.identity,
    expiresAt,
    ...(resolved.staff && preparedAdmin
      ? {
          admin: {
            value: toAdmin(resolved.staff, preparedAdmin.sessionId, preparedAdmin.expiresAt),
            ...preparedAdmin,
          },
        }
      : {}),
    ...(resolved.member && preparedMember
      ? {
          member: {
            value: { ...resolved.member, sessionId: preparedMember.sessionId, expiresAt: preparedMember.expiresAt },
            ...preparedMember,
          },
        }
      : {}),
  };
}
