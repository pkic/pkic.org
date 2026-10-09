/** Live membership capacity resolved from the canonical user session. */
import { AppError } from "../errors";
import type { AuthMember, DatabaseLike, Env } from "../types";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../db/authorization-guard";
import { guardDatabaseBatches } from "../db/guarded-database";
import { getUserSessionToken, resolveUserSessionFromRequest } from "./user-session";
import { memberSessionAuthorizationEvidence } from "./identity-capacities";
export {
  findEligibleMemberById,
  memberSignInAuthorizationEvidence,
  resolveEligibleMembershipRows,
  toAuthMember,
} from "./identity-capacities";
export type { MemberEligibleUserRow } from "./identity-capacities";

/** Apply the exact current user session and selected membership as a same-batch mutation guard. */
export function guardMemberSessionMutationDatabase(db: DatabaseLike, member: AuthMember): DatabaseLike {
  return guardDatabaseBatches(db, async (statements) => {
    try {
      const [, ...results] = await db.batch([
        prepareAuthorizationGuard(db, memberSessionAuthorizationEvidence(member)),
        ...statements,
      ]);
      return results;
    } catch (error) {
      if (isAuthorizationGuardFailure(error)) {
        throw new AppError(409, "AUTHORIZATION_CONTEXT_CHANGED", "The active user session or membership changed");
      }
      throw error;
    }
  });
}

const memberByRequest = new WeakMap<Request, AuthMember>();

export function cacheMemberForRequest(request: Request, member: AuthMember): void {
  memberByRequest.set(request, member);
}

export function getCachedMemberForRequest(request: Request): AuthMember | undefined {
  return memberByRequest.get(request);
}

export async function requireMemberFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<AuthMember> {
  const cached = memberByRequest.get(request);
  if (cached) return cached;

  if (!getUserSessionToken(request)) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
  }
  const session = await resolveUserSessionFromRequest(db, request, {
    INTERNAL_SIGNING_SECRET: env?.INTERNAL_SIGNING_SECRET,
  });
  if (!session.member) {
    throw new AppError(403, "AUTH_FORBIDDEN", "Active membership required");
  }
  cacheMemberForRequest(request, session.member);
  return session.member;
}
