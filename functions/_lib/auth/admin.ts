import { AppError } from "../errors";
import { first, run } from "../db/queries";
import { normalizeEmail } from "../validation";
import { nowIso, addMinutes, addHours } from "../utils/time";
import { randomToken, sha256Hex } from "../utils/crypto";
import { signJwt, verifyJwt, type JwtVerifyResult } from "../utils/jwt";
import { uuid } from "../utils/ids";
import { AUTH_SCOPES } from "./scopes";
import type { AuthAdmin, DatabaseLike, Env } from "../types";

interface AdminUserRow {
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
  state?: string;
  exp: number;
}

const ADMIN_SESSION_TOKEN_TYPE = "admin-session";
export const ADMIN_SESSION_COOKIE_NAME = "pkic_admin_session";
export const ADMIN_SESSION_COOKIE_PATH = "/api/v1/admin";

const adminByRequest = new WeakMap<Request, AuthAdmin>();
const adminAuthTransportByRequest = new WeakMap<Request, AdminAuthTransport>();

type AdminAuthTransport = "bearer" | "cookie" | "api-key";

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [aHash, bHash] = await Promise.all([sha256Bytes(a), sha256Bytes(b)]);
  let diff = 0;
  for (let i = 0; i < aHash.length; i++) {
    diff |= aHash[i] ^ bHash[i];
  }
  return diff === 0;
}

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

export function getAdminSessionCookieToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (!cookieHeader) return null;
  return parseCookieHeader(cookieHeader).get(ADMIN_SESSION_COOKIE_NAME) ?? null;
}

function isSecureAdminSessionRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function serializeAdminSessionCookie(token: string, request: Request): string {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${ADMIN_SESSION_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
  ];

  if (isSecureAdminSessionRequest(request)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

export function serializeExpiredAdminSessionCookie(request: Request): string {
  const parts = [
    `${ADMIN_SESSION_COOKIE_NAME}=`,
    `Path=${ADMIN_SESSION_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];

  if (isSecureAdminSessionRequest(request)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function sessionExpiresAtToExp(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid expiresAt timestamp: ${expiresAt}`);
  }
  return Math.floor(ms / 1000);
}

function isAdminSessionTokenClaims(claims: object): claims is AdminSessionTokenClaims {
  const candidate = claims as Partial<AdminSessionTokenClaims>;
  return (
    candidate.typ === ADMIN_SESSION_TOKEN_TYPE &&
    typeof candidate.sub === "string" &&
    typeof candidate.sid === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.role === "string" &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope) => typeof scope === "string") &&
    (candidate.state === undefined || typeof candidate.state === "string") &&
    typeof candidate.exp === "number"
  );
}

export async function signAdminSessionToken(
  secret: string,
  payload: {
    admin: AuthAdmin;
    sessionId: string;
    expiresAt: string;
    state?: string | null;
    scopes?: string[];
  },
): Promise<string> {
  const claims: AdminSessionTokenClaims = {
    typ: ADMIN_SESSION_TOKEN_TYPE,
    sub: payload.admin.id,
    sid: payload.sessionId,
    email: payload.admin.email,
    role: payload.admin.role,
    scopes: payload.scopes ?? payload.admin.scopes ?? [...AUTH_SCOPES],
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
    const admin = { id: "api-key", email: "api-key", role: "admin", scopes: [...AUTH_SCOPES] };
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

export async function revokeAdminSession(db: DatabaseLike, sessionId: string): Promise<void> {
  await run(db, "UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?", [nowIso(), sessionId]);
}

export async function getAdminBySessionClaims(db: DatabaseLike, claims: AdminSessionTokenClaims): Promise<AuthAdmin> {
  const row = await first<AdminSessionRow>(
    db,
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.email, u.role
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ? AND u.active = 1 AND u.role = 'admin'`,
    [claims.sid, claims.sub],
  );

  if (!row) {
    throw new AppError(401, "AUTH_INVALID", "Invalid admin session token");
  }

  if (row.revoked_at) {
    throw new AppError(401, "AUTH_REVOKED", "Admin session is revoked");
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    throw new AppError(401, "AUTH_EXPIRED", "Admin session expired");
  }

  return {
    id: row.user_id,
    email: row.email,
    role: row.role,
    scopes: claims.scopes,
    sessionId: row.id,
    expiresAt: row.expires_at,
    state: claims.state ?? null,
  };
}

export async function requestAdminMagicLink(
  db: DatabaseLike,
  payload: {
    email: string;
    ipHash?: string | null;
    userAgentHash?: string | null;
    ttlMinutes: number;
  },
): Promise<{ token: string | null; admin: AuthAdmin | null }> {
  const email = normalizeEmail(payload.email);
  const admin = await first<AdminUserRow>(
    db,
    "SELECT id, email, role, active FROM users WHERE normalized_email = ? AND active = 1 AND role = 'admin'",
    [email],
  );

  if (!admin) {
    return { token: null, admin: null };
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
      admin.id,
      tokenHash,
      addMinutes(now, payload.ttlMinutes),
      payload.ipHash ?? null,
      payload.userAgentHash ?? null,
      now,
    ],
  );

  return {
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    },
  };
}

export async function verifyAdminMagicLink(
  db: DatabaseLike,
  payload: { token: string; sessionTtlHours: number; ipHash?: string | null; userAgentHash?: string | null },
): Promise<{ admin: AuthAdmin; sessionId: string; expiresAt: string }> {
  const tokenHash = await sha256Hex(payload.token);
  const row = await first<{
    id: string;
    user_id: string;
    expires_at: string;
    used_at: string | null;
    request_ip_hash: string | null;
    user_agent_hash: string | null;
    email: string;
    role: string;
  }>(
    db,
    `SELECT m.id, m.user_id, m.expires_at, m.used_at, m.request_ip_hash, m.user_agent_hash, u.email, u.role
     FROM auth_magic_links m
     JOIN users u ON u.id = m.user_id
     WHERE m.token_hash = ? AND u.active = 1 AND u.role = 'admin'`,
    [tokenHash],
  );

  if (!row) {
    throw new AppError(404, "MAGIC_LINK_INVALID", "Invalid admin magic link token");
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

  // Atomic consume to prevent TOCTOU race: only the request that flips used_at
  // from NULL wins. Other concurrent verifications get MAGIC_LINK_USED.
  const consume = await run(db, "UPDATE auth_magic_links SET used_at = ? WHERE id = ? AND used_at IS NULL", [
    nowIso(),
    row.id,
  ]);
  if (consume.changes === 0) {
    throw new AppError(409, "MAGIC_LINK_USED", "Magic link already used");
  }

  const sessionId = uuid();
  const sessionHash = await sha256Hex(randomToken(24));
  const expiresAt = addHours(nowIso(), payload.sessionTtlHours);

  await run(
    db,
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
    [sessionId, row.user_id, sessionHash, expiresAt, nowIso()],
  );

  return {
    admin: {
      id: row.user_id,
      email: row.email,
      role: row.role,
      scopes: [...AUTH_SCOPES],
    },
    sessionId,
    expiresAt,
  };
}
