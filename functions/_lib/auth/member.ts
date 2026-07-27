/**
 * Member-facing (non-staff) authentication — PRD §4.9/§4.10.
 *
 * A parallel module to ./admin.ts, not a reuse of it: admin.ts's
 * STAFF_ACCESS_CONDITION deliberately excludes plain members (role='user'
 * with no user_roles/permission_grants), so `/api/v1/me/*` needs its own
 * eligibility gate — an active `members` row — and its own session type.
 * The underlying tables (`sessions`, `auth_magic_links`) are already
 * generic (not admin-named), so this reuses them directly, same as
 * admin.ts does, just with a distinct JWT `typ` claim so an admin session
 * token can never be replayed against a member-only endpoint or vice versa.
 *
 * Scope: magic-link login only. Passkey login for members is not built in
 * this phase — the existing passkey service (_lib/services/passkeys.ts)
 * hardcodes admin-session issuance (findEligibleStaffUserById,
 * issueAdminSession) in completePasskeyAuthentication, and generalizing it
 * is more surface area than Phase 4A's actual requirements call for (the
 * PRD's "Auth modernization" goal already treats magic link as a fully
 * sufficient fallback). Flagged as follow-up in prd.md, same class of
 * decision as Phase 3's deferred passkey management UI.
 */
import { AppError } from "../errors";
import { first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso, addMinutes, addHours } from "../utils/time";
import { randomToken, sha256Hex } from "../utils/crypto";
import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import { uuid } from "../utils/ids";
import type { AuthMember, DatabaseLike, Env } from "../types";

interface MemberEligibleUserRow {
  id: string;
  email: string;
  active: number;
  member_id: string;
  organization_id: string | null;
  membership_category: string;
  is_ec_member: number;
}

// A user is member-session-eligible when they hold an active `members` row
// — the INNER JOIN below is the whole eligibility gate. Unlike admin's
// STAFF_ACCESS_CONDITION there is no role or grant check; self-service is
// identity-gated (see AuthMember's doc comment in types.ts).
const MEMBER_ELIGIBLE_USER_SELECT = `
  SELECT u.id, u.email, u.active, u.is_ec_member,
         m.id AS member_id, m.organization_id, m.member_type AS membership_category
  FROM users u
  JOIN members m ON m.user_id = u.id AND m.status = 'active'
`;

interface MemberSessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface MemberSessionTokenClaims {
  typ: "member-session";
  sub: string;
  sid: string;
  exp: number;
}

const MEMBER_SESSION_TOKEN_TYPE = "member-session";
export const MEMBER_SESSION_COOKIE_NAME = "pkic_member_session";
export const MEMBER_SESSION_COOKIE_PATH = "/api/v1";

const memberByRequest = new WeakMap<Request, AuthMember>();

function parseCookieHeader(cookieHeader: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!name) continue;
    values.set(name, decodeURIComponent(value));
  }
  return values;
}

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function getMemberSessionCookieToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (!cookieHeader) return null;
  return parseCookieHeader(cookieHeader).get(MEMBER_SESSION_COOKIE_NAME) ?? null;
}

function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function serializeMemberSessionCookie(token: string, request: Request): string {
  const parts = [
    `${MEMBER_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${MEMBER_SESSION_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

export function serializeExpiredMemberSessionCookie(request: Request): string {
  const parts = [
    `${MEMBER_SESSION_COOKIE_NAME}=`,
    `Path=${MEMBER_SESSION_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

function sessionExpiresAtToExp(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid expiresAt timestamp: ${expiresAt}`);
  }
  return Math.floor(ms / 1000);
}

function isMemberSessionTokenClaims(claims: object): claims is MemberSessionTokenClaims {
  const candidate = claims as Partial<MemberSessionTokenClaims>;
  return (
    candidate.typ === MEMBER_SESSION_TOKEN_TYPE &&
    typeof candidate.sub === "string" &&
    typeof candidate.sid === "string" &&
    typeof candidate.exp === "number"
  );
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
  const row = await first<MemberEligibleUserRow>(db, `${MEMBER_ELIGIBLE_USER_SELECT} WHERE u.id = ? AND u.active = 1`, [
    userId,
  ]);
  return row ? toAuthMember(row) : null;
}

export async function issueMemberSession(
  db: DatabaseLike,
  member: AuthMember,
  sessionTtlHours: number,
): Promise<{ member: AuthMember; sessionId: string; expiresAt: string }> {
  const sessionId = uuid();
  const sessionHash = await sha256Hex(randomToken(24));
  const expiresAt = addHours(nowIso(), sessionTtlHours);

  await run(
    db,
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [sessionId, member.userId, sessionHash, expiresAt, nowIso()],
  );

  return { member: { ...member, sessionId, expiresAt }, sessionId, expiresAt };
}

async function getMemberBySessionClaims(db: DatabaseLike, claims: MemberSessionTokenClaims): Promise<AuthMember> {
  const row = await first<MemberSessionRow>(
    db,
    `SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE id = ? AND user_id = ?`,
    [claims.sid, claims.sub],
  );

  if (!row) {
    throw new AppError(401, "AUTH_INVALID", "Invalid member session token");
  }
  if (row.revoked_at) {
    throw new AppError(401, "AUTH_REVOKED", "Member session is revoked");
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(401, "AUTH_EXPIRED", "Member session expired");
  }

  const member = await findEligibleMemberById(db, claims.sub);
  if (!member) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This account is no longer an active member");
  }

  return { ...member, sessionId: row.id, expiresAt: row.expires_at };
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
    `${MEMBER_ELIGIBLE_USER_SELECT} WHERE u.normalized_email = ? AND u.active = 1`,
    [email],
  );

  if (!row) {
    return { token: null, member: null };
  }

  const token = randomToken(24);
  const tokenHash = await sha256Hex(token);
  const now = nowIso();

  await run(
    db,
    `INSERT INTO auth_magic_links (
      id, user_id, token_hash, expires_at, used_at, request_ip_hash, user_agent_hash, created_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      uuid(),
      row.id,
      tokenHash,
      addMinutes(now, payload.ttlMinutes),
      payload.ipHash ?? null,
      payload.userAgentHash ?? null,
      now,
    ],
  );

  return { token, member: toAuthMember(row) };
}

export async function verifyMemberMagicLink(
  db: DatabaseLike,
  payload: { token: string; sessionTtlHours: number; ipHash?: string | null; userAgentHash?: string | null },
): Promise<{ member: AuthMember; sessionId: string; expiresAt: string }> {
  const tokenHash = await sha256Hex(payload.token);
  const row = await first<{
    id: string;
    user_id: string;
    expires_at: string;
    used_at: string | null;
    request_ip_hash: string | null;
    user_agent_hash: string | null;
  }>(
    db,
    `SELECT id, user_id, expires_at, used_at, request_ip_hash, user_agent_hash FROM auth_magic_links WHERE token_hash = ?`,
    [tokenHash],
  );

  if (!row) {
    throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid member magic link token");
  }
  if (row.used_at) {
    throw new AppError(409, "MAGIC_LINK_USED", "Magic link already used");
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(410, "MAGIC_LINK_EXPIRED", "Magic link expired");
  }
  if (row.request_ip_hash && row.request_ip_hash !== payload.ipHash) {
    throw new AppError(403, "MAGIC_LINK_CONTEXT_MISMATCH", "Magic link is not valid from this network");
  }
  if (row.user_agent_hash && row.user_agent_hash !== payload.userAgentHash) {
    throw new AppError(403, "MAGIC_LINK_CONTEXT_MISMATCH", "Magic link is not valid from this browser");
  }

  const consume = await run(db, "UPDATE auth_magic_links SET used_at = ? WHERE id = ? AND used_at IS NULL", [
    nowIso(),
    row.id,
  ]);
  if (consume.changes === 0) {
    throw new AppError(409, "MAGIC_LINK_USED", "Magic link already used");
  }

  const member = await findEligibleMemberById(db, row.user_id);
  if (!member) {
    throw new AppError(403, "AUTH_FORBIDDEN", "This account is no longer an active member");
  }

  return issueMemberSession(db, member, payload.sessionTtlHours);
}

export async function revokeMemberSession(db: DatabaseLike, sessionId: string): Promise<void> {
  await run(db, "UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", [nowIso(), sessionId]);
}
