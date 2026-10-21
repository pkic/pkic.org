/** Live membership capacity resolved from the canonical user session. */
import { AppError } from "../errors";
import type { AuthMember, DatabaseLike, Env } from "../types";
import { guardAuthorizedDatabase } from "../db/authorization-guard";
import { getUserSessionToken, resolveUserSessionFromRequest } from "./user-session";
import { memberSessionAuthorizationEvidence, userSessionAuthorizationEvidence } from "./identity-capacities";
export {
  findEligibleMemberById,
  memberSignInAuthorizationEvidence,
  resolveEligibleMembershipRows,
  selectActingMember,
} from "./identity-capacities";
export type { MemberEligibleUserRow } from "./identity-capacities";

/** Apply the exact current user session and selected membership as a same-batch mutation guard. */
export function guardMemberSessionMutationDatabase(db: DatabaseLike, member: AuthMember): DatabaseLike {
  return guardAuthorizedDatabase(
    db,
    memberSessionAuthorizationEvidence(member),
    () => new AppError(409, "AUTHORIZATION_CONTEXT_CHANGED", "The active user session or membership changed"),
  );
}

/** The signed-in user behind an own-account route, with the membership context only when the session has one. */
export interface OwnAccount {
  userId: string;
  sessionId: string;
  member: AuthMember | null;
}

/** Requires a live user session; own-account routes need no capacity. */
export async function requireOwnAccountFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "INTERNAL_SIGNING_SECRET">,
): Promise<OwnAccount> {
  if (!getUserSessionToken(request)) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
  }
  const session = await resolveUserSessionFromRequest(db, request, {
    INTERNAL_SIGNING_SECRET: env?.INTERNAL_SIGNING_SECRET,
  });
  return { userId: session.identity.id, sessionId: session.sessionId, member: session.member ?? null };
}

/** Guards an own-account mutation by the exact live session, and by the selected membership when it acts through one. */
export function guardOwnAccountMutationDatabase(db: DatabaseLike, account: OwnAccount): DatabaseLike {
  if (account.member) return guardMemberSessionMutationDatabase(db, account.member);
  return guardUserSessionDatabase(db, account);
}

/** Account-owned resources recheck the person/session without depending on an unrelated acting membership. */
export function guardUserSessionDatabase(
  db: DatabaseLike,
  account: Pick<OwnAccount, "userId" | "sessionId">,
): DatabaseLike {
  return guardAuthorizedDatabase(
    db,
    userSessionAuthorizationEvidence(account.userId, account.sessionId),
    () => new AppError(409, "AUTHORIZATION_CONTEXT_CHANGED", "The active user session changed"),
  );
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
