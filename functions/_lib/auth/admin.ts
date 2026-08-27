import { AppError } from "../errors";
import { first } from "../db/queries";
import { normalizeEmail } from "../validation";
import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import { constantTimeEqual } from "../utils/crypto";
import { AUTH_SCOPES } from "./scopes";
import { computeGrantsForUser } from "./permissions";
import type { AuthAdmin, DatabaseLike, Env, StatementLike, UserBackedAuthAdmin } from "../types";
import { createServiceAuthAdmin, createUserBackedAuthAdmin, requireUserBackedAuthAdmin } from "./admin-identity";
import {
  getBearerToken,
  getSessionCookieToken,
  serializeSessionCookie,
  serializeExpiredSessionCookie,
  sessionExpiresAtToExp,
  hasBaseSessionTokenClaims,
  insertSessionRow,
  prepareSessionRow,
  assertSessionActive,
  revokeSessionRow,
  prepareRevokeSessionRow,
  type SessionTableConfig,
} from "./session-engine";
import { ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_PATH } from "./session-cookies";
export { ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_PATH } from "./session-cookies";
import { prepareVerifyPrimaryEmailStatement } from "../services/email-verification";
import { prepareVerifiedDomainAssociationStatements } from "../services/organization-representations";
import { nowIso } from "../utils/time";
import {
  assertEmailAuthCapabilityEmail,
  commitEmailAuthRedemption,
  queueEmailAuthCapability,
  verifyEmailAuthCapabilityToken,
} from "./email-auth-capabilities";
import type { EmailAuthCapabilityPurpose } from "./capability-links";
import type { AuthorizationEvidence } from "../db/authorization-guard";

/**
 * Who may sign in through the admin auth flow (magic link / session).
 *
 * Historically this was `role = 'admin'` only — the legacy flat admin flag.
 * Introduces non-admin staff roles (membership_processor,
 * wg_chair, event_organizer, program_committee) that must also be able to
 * log in, scoped to whatever `user_roles`/`permission_grants` they hold.
 * `role='admin'` remains a valid path (the column is retained,
 * non-authoritative, backfilled into `user_roles` at migration time), OR'd
 * with "has at least one active (non-expired, non-revoked) grant" so a
 * membership processor with zero admin-only-route access can still obtain a
 * session and be authorized per-permission on endpoints.
 */
const STAFF_ACCESS_CONDITION = `(
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

export interface EligibleStaffUser {
  id: string;
  email: string;
  role: string;
  active: number;
}

interface AdminSessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  email: string;
  role: string;
}

export interface AdminSessionTokenClaims {
  typ: "admin-session";
  sub: string;
  sid: string;
  email: string;
  role: string;
  scopes: string[];
  scopeRestricted?: boolean;
  state?: string;
  exp: number;
}

const ADMIN_SESSION_TOKEN_TYPE = "admin-session";

const SESSIONS_TABLE: SessionTableConfig = { table: "sessions", subjectColumn: "user_id" };
export type AdminMagicLinkPurpose = Extract<EmailAuthCapabilityPurpose, "admin_sign_in" | "mcp_oauth_sign_in">;

const adminByRequest = new WeakMap<Request, AuthAdmin>();
const adminAuthTransportByRequest = new WeakMap<Request, AdminAuthTransport>();

type AdminAuthTransport = "bearer" | "cookie" | "api-key";

export function cacheAdminForRequest(request: Request, admin: AuthAdmin, transport?: AdminAuthTransport): void {
  adminByRequest.set(request, admin);
  if (transport) {
    adminAuthTransportByRequest.set(request, transport);
  }
}

export function getCachedAdminForRequest(request: Request): AuthAdmin | undefined {
  return adminByRequest.get(request);
}

export function getCachedAdminAuthTransport(request: Request): AdminAuthTransport | undefined {
  return adminAuthTransportByRequest.get(request);
}

export function getAdminSessionCookieToken(request: Request): string | null {
  return getSessionCookieToken(request, ADMIN_SESSION_COOKIE_NAME);
}

export function serializeAdminSessionCookie(token: string, request: Request): string {
  return serializeSessionCookie(ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_PATH, token, request);
}

export function serializeExpiredAdminSessionCookie(request: Request): string {
  return serializeExpiredSessionCookie(ADMIN_SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_PATH, request);
}

function isAdminSessionTokenClaims(claims: object): claims is AdminSessionTokenClaims {
  if (!hasBaseSessionTokenClaims(claims, ADMIN_SESSION_TOKEN_TYPE)) return false;
  const candidate = claims as Partial<AdminSessionTokenClaims>;
  return (
    typeof candidate.email === "string" &&
    typeof candidate.role === "string" &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope) => typeof scope === "string") &&
    (candidate.scopeRestricted === undefined || typeof candidate.scopeRestricted === "boolean") &&
    (candidate.state === undefined || typeof candidate.state === "string")
  );
}

export async function signAdminSessionToken(
  secret: string,
  payload: {
    admin: UserBackedAuthAdmin;
    sessionId: string;
    expiresAt: string;
    state?: string | null;
    scopes?: string[];
    scopeRestricted?: boolean;
  },
): Promise<string> {
  const claims: AdminSessionTokenClaims = {
    typ: ADMIN_SESSION_TOKEN_TYPE,
    sub: payload.admin.id,
    sid: payload.sessionId,
    email: payload.admin.email,
    role: payload.admin.role,
    scopes: payload.scopes ?? payload.admin.scopes ?? [...AUTH_SCOPES],
    scopeRestricted: payload.scopeRestricted ?? payload.admin.scopeRestricted,
    exp: sessionExpiresAtToExp(payload.expiresAt),
  };

  if (payload.state) {
    claims.state = payload.state;
  }

  return signJwt(secret, claims as unknown as Record<string, unknown>);
}

export async function verifyAdminSessionToken(
  secret: string,
  token: string,
): Promise<JwtVerifyResult<AdminSessionTokenClaims>> {
  const result = await verifyJwt<object>(secret, token);
  if (!result.ok) {
    return result;
  }
  if (!isAdminSessionTokenClaims(result.claims)) {
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, claims: result.claims };
}

export async function requireAdminFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
): Promise<AuthAdmin> {
  const cached = adminByRequest.get(request);
  if (cached) {
    return cached;
  }

  const bearerToken = getBearerToken(request);
  const cookieToken = getAdminSessionCookieToken(request);
  const token = bearerToken ?? cookieToken;
  if (!token) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing bearer token");
  }

  // API key auth — no DB lookup needed, returns a synthetic admin identity.
  // Use constant-time comparison to avoid leaking the configured key via timing.
  if (env?.ADMIN_API_KEY && (await constantTimeEqual(token, env.ADMIN_API_KEY))) {
    const admin = createServiceAuthAdmin({
      id: "api-key",
      email: "api-key",
      role: "admin",
      scopes: [...AUTH_SCOPES],
    });
    cacheAdminForRequest(request, admin, "api-key");
    return admin;
  }

  if (!env?.INTERNAL_SIGNING_SECRET) {
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  }

  const verified = await verifyAdminSessionToken(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok) {
    throw new AppError(
      401,
      verified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
      verified.reason === "expired" ? "Admin session expired" : "Invalid admin session token",
    );
  }

  const admin = await getAdminBySessionClaims(db, verified.claims);
  cacheAdminForRequest(request, admin, bearerToken ? "bearer" : "cookie");
  return admin;
}

/** Require an attributable database user for writes whose audit/history rows reference users(id). */
export async function requireUserBackedAdminFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
): Promise<UserBackedAuthAdmin> {
  const admin = await requireAdminFromRequest(db, request, env);
  return requireUserBackedAuthAdmin(admin);
}

export async function revokeAdminSession(db: DatabaseLike, sessionId: string): Promise<void> {
  await revokeSessionRow(db, SESSIONS_TABLE.table, sessionId);
}

export function prepareRevokeAdminSession(db: DatabaseLike, sessionId: string): StatementLike {
  return prepareRevokeSessionRow(db, SESSIONS_TABLE.table, sessionId);
}

/**
 * True if `userId` is currently eligible to hold a session at all — the same
 * STAFF_ACCESS_CONDITION gate `queueAdminSignInCapability`/`redeemAdminSignInCapability`
 * apply. Used by the passkey authentication flow to
 * re-check eligibility at login time rather than trusting that it still
 * holds just because a passkey was registered in the past (registration
 * itself requires an already-authenticated, already-eligible actor — see
 * register/begin's use of requireAdminFromRequest).
 */
export async function findEligibleStaffUserById(db: DatabaseLike, userId: string): Promise<EligibleStaffUser | null> {
  return first<EligibleStaffUser>(
    db,
    `SELECT id, email, role, active FROM users u WHERE u.id = ? AND u.active = 1 AND ${STAFF_ACCESS_CONDITION}`,
    [userId],
  );
}

/**
 * Re-resolves a user-backed admin identity for short-lived delegated flows.
 * Unlike a signed actor claim, this reflects current deactivation and staff
 * eligibility state and recomputes grants after each resolution.
 */
export async function getCurrentUserBackedAdmin(
  db: DatabaseLike,
  userId: string,
  sessionId: string,
): Promise<UserBackedAuthAdmin | null> {
  const session = await first<AdminSessionRow>(
    db,
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.user_id = ? AND u.active = 1 AND ${STAFF_ACCESS_CONDITION}`,
    [sessionId, userId],
  );
  try {
    assertSessionActive(session ? { revokedAt: session.revoked_at, expiresAt: session.expires_at } : null, "admin");
  } catch {
    return null;
  }

  return createUserBackedAuthAdmin({
    id: session!.user_id,
    email: session!.email,
    role: session!.role,
    scopes: session!.role === "admin" ? [...AUTH_SCOPES] : [],
    grants: await computeGrantsForUser(db, session!.user_id),
    sessionId: session!.id,
    expiresAt: session!.expires_at,
  });
}

/**
 * Creates a `sessions` row for an already-verified user and returns the same
 * shape `redeemAdminSignInCapability` does, so any login entry point (magic link,
 * passkey) can share one session-issuance path.
 */
export async function issueAdminSession(
  db: DatabaseLike,
  user: Pick<EligibleStaffUser, "id" | "email" | "role">,
  sessionTtlHours: number,
): Promise<{ admin: UserBackedAuthAdmin; sessionId: string; expiresAt: string }> {
  const { sessionId, expiresAt } = await insertSessionRow(db, SESSIONS_TABLE, user.id, sessionTtlHours);

  return {
    admin: createUserBackedAuthAdmin({
      id: user.id,
      email: user.email,
      role: user.role,
      scopes: user.role === "admin" ? [...AUTH_SCOPES] : [],
    }),
    sessionId,
    expiresAt,
  };
}

export async function getAdminBySessionClaims(
  db: DatabaseLike,
  claims: AdminSessionTokenClaims,
): Promise<UserBackedAuthAdmin> {
  const row = await first<AdminSessionRow>(
    db,
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.email, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ? AND u.active = 1 AND ${STAFF_ACCESS_CONDITION}`,
    [claims.sid, claims.sub],
  );

  // assertSessionActive throws (401 AUTH_INVALID/AUTH_REVOKED/AUTH_EXPIRED) before
  // this point if row is null/revoked/expired, so the non-null assertion below is safe.
  assertSessionActive(row ? { revokedAt: row.revoked_at, expiresAt: row.expires_at } : null, "admin");
  const activeRow = row!;

  const grants = await computeGrantsForUser(db, activeRow.user_id);

  return createUserBackedAuthAdmin({
    id: activeRow.user_id,
    email: activeRow.email,
    role: activeRow.role,
    scopes: claims.scopes,
    scopeRestricted: claims.scopeRestricted ?? false,
    grants,
    sessionId: activeRow.id,
    expiresAt: activeRow.expires_at,
    state: claims.state ?? null,
  });
}

export async function queueAdminSignInCapability(
  db: DatabaseLike,
  payload: {
    email: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    ttlMinutes: number;
    signingSecret: string;
    purpose?: AdminMagicLinkPurpose;
    returnTo?: string;
  },
): Promise<{
  queuedToken: string | null;
  admin: UserBackedAuthAdmin | null;
}> {
  const email = normalizeEmail(payload.email);
  const admin = await first<EligibleStaffUser>(
    db,
    `SELECT id, email, role, active FROM users u WHERE normalized_email = ? AND active = 1 AND ${STAFF_ACCESS_CONDITION}`,
    [email],
  );

  if (!admin) {
    return { queuedToken: null, admin: null };
  }

  const purpose = payload.purpose ?? "admin_sign_in";
  const magic = await queueEmailAuthCapability({
    signingSecret: payload.signingSecret,
    purpose,
    subjectId: admin.id,
    email: admin.email,
    ttlSeconds: payload.ttlMinutes * 60,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
    returnTo: payload.returnTo,
  });

  return {
    queuedToken: magic.queuedToken,
    admin: createUserBackedAuthAdmin({
      id: admin.id,
      email: admin.email,
      role: admin.role,
    }),
  };
}

export async function redeemAdminSignInCapability(
  db: DatabaseLike,
  payload: {
    token: string;
    signingSecret: string;
    sessionTtlHours: number;
    ipHash?: string | null;
    userAgentHash?: string | null;
    purpose?: AdminMagicLinkPurpose;
    auditAction?: string;
  },
): Promise<{ admin: UserBackedAuthAdmin; sessionId: string; expiresAt: string; returnTo?: string }> {
  const purpose = payload.purpose ?? "admin_sign_in";
  const capability = await verifyEmailAuthCapabilityToken({
    signingSecret: payload.signingSecret,
    purpose,
    token: payload.token,
    ipHash: payload.ipHash,
    userAgentHash: payload.userAgentHash,
  });
  const row = await first<EligibleStaffUser>(
    db,
    `SELECT id, email, role, active FROM users u WHERE u.id = ? AND u.active = 1 AND ${STAFF_ACCESS_CONDITION}`,
    [capability.subjectId],
  );

  if (!row) {
    throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid admin magic link token");
  }

  await assertEmailAuthCapabilityEmail({
    signingSecret: payload.signingSecret,
    capability,
    currentEmail: row.email,
  });

  // Legacy AUTH_SCOPES only apply to role='admin' — a staff role
  // (membership_processor, wg_chair, event_organizer, program_committee)
  // authorizes purely through `grants`, computed fresh from
  // user_roles/permission_grants on every request (see
  // getAdminBySessionClaims), not baked into this token. issueAdminSession
  // applies that same rule.
  const session = await prepareSessionRow(db, SESSIONS_TABLE, row.id, payload.sessionTtlHours);
  const normalizedEmail = normalizeEmail(row.email);
  const verifiedAt = nowIso();
  await commitEmailAuthRedemption(db, {
    purpose,
    capabilityId: capability.capabilityId,
    actorType: "admin",
    actorId: row.id,
    action: payload.auditAction ?? "admin_magic_link_verified",
    entityType: "admin_session",
    entityId: session.sessionId,
    details: {
      expiresAt: session.expiresAt,
      purpose,
    },
    createdAt: verifiedAt,
    authorizationEvidence: staffSignInAuthorizationEvidence(row.id, normalizedEmail),
    statements: [
      prepareVerifyPrimaryEmailStatement(db, {
        userId: row.id,
        normalizedEmail,
        method: "magic_link",
        verifiedAt,
      }),
      ...(await prepareVerifiedDomainAssociationStatements(db, {
        userId: row.id,
        normalizedEmail,
        at: verifiedAt,
      })),
      session.statement,
    ],
  });
  return {
    admin: createUserBackedAuthAdmin({
      id: row.id,
      email: row.email,
      role: row.role,
      scopes: row.role === "admin" ? [...AUTH_SCOPES] : [],
    }),
    sessionId: session.sessionId,
    expiresAt: session.expiresAt,
    ...(capability.returnTo ? { returnTo: capability.returnTo } : {}),
  };
}
