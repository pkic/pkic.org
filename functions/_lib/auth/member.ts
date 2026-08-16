/**
 * Member-facing (non-staff) authentication.
 *
 * Shares session/magic-link mechanism with ./admin.ts and
 * ./sponsor-portal.ts via ./session-engine.ts (cookie parsing, JWT claims
 * base shape, session/magic-link row issue/fetch/consume). What stays
 * separate is the eligibility gate and identity: admin.ts's
 * STAFF_ACCESS_CONDITION deliberately excludes plain members (role='user'
 * with no user_roles/permission_grants), so `/api/v1/me/*` needs its own
 * eligibility gate — an active `members` row — and its own JWT `typ` claim
 * so an admin session token can never be replayed against a member-only
 * endpoint or vice versa.
 *
 * Scope: magic-link login only. Passkey login for members is not built in
 * this phase — the existing passkey service (_lib/services/passkeys.ts)
 * hardcodes admin-session issuance (findEligibleStaffUserById,
 * issueAdminSession) in completePasskeyAuthentication, and generalizing it
 * is more surface area than call for (the
 * "Auth modernization" goal already treats magic link as a fully
 * sufficient fallback). same class of
 * decision as the deferred passkey management UI.
 */
import { AppError } from "../errors";
import { first } from "../db/queries";
import { normalizeEmail } from "../validation";
import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import type { AuthMember, DatabaseLike, Env } from "../types";
import {
  getBearerToken,
  getSessionCookieToken,
  serializeSessionCookie,
  serializeExpiredSessionCookie,
  sessionExpiresAtToExp,
  hasBaseSessionTokenClaims,
  insertSessionRow,
  fetchSessionRow,
  assertSessionActive,
  revokeSessionRow,
  insertMagicLinkRow,
  fetchMagicLinkRowByToken,
  validateAndConsumeMagicLinkRow,
  type SessionTableConfig,
  type MagicLinkTableConfig,
} from "./session-engine";

interface MemberEligibleUserRow {
  id: string;
  email: string;
  normalized_email: string;
  active: number;
  member_id: string;
  organization_id: string | null;
  membership_category: string;
  is_ec_member: number;
}

// A user is member-session-eligible when they hold an active individual
// `members` row (org-less: member_type='individual', user_id=that user) OR
// an active `organization_representatives` row for an active org-tied
// aggregate (org-tied members rows have user_id IS NULL — migration
// 0000's CHECK — so a representative is never found via members.user_id
// directly). Unlike admin's STAFF_ACCESS_CONDITION there is no role or
// grant check; self-service is identity-gated (see AuthMember's doc
// comment in types.ts).
//
// A person who is simultaneously an org-less individual member AND an
// active representative of some organization (edge case, not disallowed by
// any constraint) would match both halves of this UNION; the first row D1
// returns wins. Not resolved further in this pass.
const MEMBER_ELIGIBLE_USER_SELECT = `
  SELECT u.id, u.email, u.normalized_email, u.active, u.is_ec_member,
         m.id AS member_id, NULL AS organization_id,
         mca.category_code AS membership_category
  FROM users u
  JOIN members m ON m.user_id = u.id AND m.status = 'active'
  JOIN member_category_assignments mca ON mca.member_id = m.id

  UNION ALL

  SELECT u.id, u.email, u.normalized_email, u.active, u.is_ec_member,
         m.id AS member_id, m.organization_id,
         mca.category_code AS membership_category
  FROM users u
  JOIN organization_representatives r ON r.user_id = u.id AND r.left_at IS NULL
  JOIN members m ON m.id = r.member_id AND m.status = 'active'
  JOIN member_category_assignments mca ON mca.member_id = m.id
`;

export interface MemberSessionTokenClaims {
  typ: "member-session";
  sub: string;
  sid: string;
  exp: number;
}

const MEMBER_SESSION_TOKEN_TYPE = "member-session";
export const MEMBER_SESSION_COOKIE_NAME = "pkic_member_session";
export const MEMBER_SESSION_COOKIE_PATH = "/api/v1";

const SESSIONS_TABLE: SessionTableConfig = { table: "sessions", subjectColumn: "user_id" };
const MAGIC_LINKS_TABLE: MagicLinkTableConfig = { table: "auth_magic_links", subjectColumn: "user_id" };

const memberByRequest = new WeakMap<Request, AuthMember>();

export function getMemberSessionCookieToken(request: Request): string | null {
  return getSessionCookieToken(request, MEMBER_SESSION_COOKIE_NAME);
}

export function serializeMemberSessionCookie(token: string, request: Request): string {
  return serializeSessionCookie(MEMBER_SESSION_COOKIE_NAME, MEMBER_SESSION_COOKIE_PATH, token, request);
}

export function serializeExpiredMemberSessionCookie(request: Request): string {
  return serializeExpiredSessionCookie(MEMBER_SESSION_COOKIE_NAME, MEMBER_SESSION_COOKIE_PATH, request);
}

function isMemberSessionTokenClaims(claims: object): claims is MemberSessionTokenClaims {
  return hasBaseSessionTokenClaims(claims, MEMBER_SESSION_TOKEN_TYPE);
}

function toAuthMember(row: MemberEligibleUserRow): AuthMember {
  return {
    userId: row.id,
    email: row.email,
    memberId: row.member_id,
    organizationId: row.organization_id,
    membershipCategory: row.membership_category,
    isEcMember: row.is_ec_member === 1,
  };
}

export async function signMemberSessionToken(
  secret: string,
  payload: { userId: string; sessionId: string; expiresAt: string },
): Promise<string> {
  const claims: MemberSessionTokenClaims = {
    typ: MEMBER_SESSION_TOKEN_TYPE,
    sub: payload.userId,
    sid: payload.sessionId,
    exp: sessionExpiresAtToExp(payload.expiresAt),
  };
  return signJwt(secret, claims as unknown as Record<string, unknown>);
}

export async function verifyMemberSessionToken(
  secret: string,
  token: string,
): Promise<JwtVerifyResult<MemberSessionTokenClaims>> {
  const result = await verifyJwt<object>(secret, token);
  if (!result.ok) return result;
  if (!isMemberSessionTokenClaims(result.claims)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, claims: result.claims };
}

/** True if `userId` currently holds an active `members` row. */
export async function findEligibleMemberById(db: DatabaseLike, userId: string): Promise<AuthMember | null> {
  const row = await first<MemberEligibleUserRow>(
    db,
    `SELECT * FROM (${MEMBER_ELIGIBLE_USER_SELECT}) combined WHERE id = ? AND active = 1`,
    [userId],
  );
  return row ? toAuthMember(row) : null;
}

export async function issueMemberSession(
  db: DatabaseLike,
  member: AuthMember,
  sessionTtlHours: number,
): Promise<{ member: AuthMember; sessionId: string; expiresAt: string }> {
  const { sessionId, expiresAt } = await insertSessionRow(db, SESSIONS_TABLE, member.userId, sessionTtlHours);
  return { member: { ...member, sessionId, expiresAt }, sessionId, expiresAt };
}

async function getMemberBySessionClaims(db: DatabaseLike, claims: MemberSessionTokenClaims): Promise<AuthMember> {
  const row = assertSessionActive(await fetchSessionRow(db, SESSIONS_TABLE, claims.sid, claims.sub), "member");

  const member = await findEligibleMemberById(db, claims.sub);
  if (!member) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This account is no longer an active member");
  }

  return { ...member, sessionId: row.id, expiresAt: row.expiresAt };
}

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

  const token = getBearerToken(request) ?? getMemberSessionCookieToken(request);
  if (!token) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing member session token");
  }

  if (!env?.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }

  const verified = await verifyMemberSessionToken(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok) {
    throw new AppError(
      401,
      verified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
      verified.reason === "expired" ? "Member session expired" : "Invalid member session token",
    );
  }

  const member = await getMemberBySessionClaims(db, verified.claims);
  cacheMemberForRequest(request, member);
  return member;
}

export async function requestMemberMagicLink(
  db: DatabaseLike,
  payload: { email: string; ipHash?: string | null; userAgentHash?: string | null; ttlMinutes: number },
): Promise<{ token: string | null; member: AuthMember | null }> {
  const email = normalizeEmail(payload.email);
  const row = await first<MemberEligibleUserRow>(
    db,
    `SELECT * FROM (${MEMBER_ELIGIBLE_USER_SELECT}) combined WHERE normalized_email = ? AND active = 1`,
    [email],
  );

  if (!row) {
    return { token: null, member: null };
  }

  const token = await insertMagicLinkRow(db, MAGIC_LINKS_TABLE, row.id, payload);
  return { token, member: toAuthMember(row) };
}

export async function verifyMemberMagicLink(
  db: DatabaseLike,
  payload: { token: string; sessionTtlHours: number; ipHash?: string | null; userAgentHash?: string | null },
): Promise<{ member: AuthMember; sessionId: string; expiresAt: string }> {
  const row = await fetchMagicLinkRowByToken(db, MAGIC_LINKS_TABLE, payload.token);
  if (!row) {
    throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid member magic link token");
  }

  await validateAndConsumeMagicLinkRow(db, MAGIC_LINKS_TABLE.table, row, payload);

  const member = await findEligibleMemberById(db, row.subjectId);
  if (!member) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This account is no longer an active member");
  }

  return issueMemberSession(db, member, payload.sessionTtlHours);
}

export async function revokeMemberSession(db: DatabaseLike, sessionId: string): Promise<void> {
  await revokeSessionRow(db, SESSIONS_TABLE.table, sessionId);
}
