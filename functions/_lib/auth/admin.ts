import { AppError } from "../errors";
import { first } from "../db/queries";
import { constantTimeEqual } from "../utils/crypto";
import { AUTH_SCOPES } from "./scopes";
import { computeGrantsForUser } from "./permissions";
import type { AuthAdmin, DatabaseLike, Env, UserBackedAuthAdmin } from "../types";
import { createServiceAuthAdmin, createUserBackedAuthAdmin, requireUserBackedAuthAdmin } from "./admin-identity";
import { assertSessionActive, getBearerToken } from "./session-engine";
import { getUserSessionCookieToken, resolveUserSessionFromRequest, USER_SESSION_TOKEN_HEADER } from "./user-session";
import { verifyMcpSessionToken } from "./mcp-session";
import { STAFF_ACCESS_CONDITION } from "./identity-capacities";

/** Live staff capacity projected from the canonical human user session. */
interface AdminSessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  email: string;
  role: string;
}

const adminByRequest = new WeakMap<Request, AuthAdmin>();
const adminAuthTransportByRequest = new WeakMap<Request, AdminAuthTransport>();

type AdminAuthTransport = "bearer" | "cookie" | "api-key";
const MACHINE_AUTH_HEADER = "x-pkic-machine-auth";

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

export async function requireAdminFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
): Promise<AuthAdmin> {
  const cached = adminByRequest.get(request);
  if (cached) {
    return cached;
  }

  const explicitUserTransport = Boolean(
    request.headers.get(USER_SESSION_TOKEN_HEADER) || getUserSessionCookieToken(request),
  );
  const token = getBearerToken(request);
  if (!token && !explicitUserTransport) {
    throw new AppError(401, "AUTH_REQUIRED", "Missing bearer token");
  }

  // API key auth is an explicit service identity. It never enters the human
  // session verifier and therefore cannot be confused with a user JWT.
  // Use constant-time comparison to avoid leaking the configured key via timing.
  if (!explicitUserTransport && token && env?.ADMIN_API_KEY && (await constantTimeEqual(token, env.ADMIN_API_KEY))) {
    const admin = createServiceAuthAdmin({
      id: "api-key",
      email: "api-key",
      role: "admin",
      scopes: [...AUTH_SCOPES],
    });
    cacheAdminForRequest(request, admin, "api-key");
    return admin;
  }

  if (!explicitUserTransport && request.headers.get(MACHINE_AUTH_HEADER) === "mcp") {
    const internalSecret = env?.INTERNAL_SIGNING_SECRET;
    if (!internalSecret) {
      throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
    }
    const mcpVerified = await verifyMcpSessionToken(internalSecret, token!);
    if (!mcpVerified.ok) {
      throw new AppError(
        401,
        mcpVerified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
        mcpVerified.reason === "expired" ? "MCP session expired" : "Invalid MCP session token",
      );
    }
    const liveAdmin = await getCurrentUserBackedAdmin(db, mcpVerified.claims.sub, mcpVerified.claims.sid);
    if (!liveAdmin) throw new AppError(401, "AUTH_INVALID", "MCP session is no longer active");
    const admin = createUserBackedAuthAdmin({
      ...liveAdmin,
      scopes: mcpVerified.claims.scopes,
      scopeRestricted: true,
      state: mcpVerified.claims.state ?? null,
    });
    cacheAdminForRequest(request, admin, "bearer");
    return admin;
  }

  // Every remaining credential is the one canonical human session. Capacity
  // and grants are re-resolved from live D1; no JWT authority claims are trusted.
  const userSession = await resolveUserSessionFromRequest(db, request, {
    INTERNAL_SIGNING_SECRET: env?.INTERNAL_SIGNING_SECRET,
  });
  if (!userSession.staff) {
    throw new AppError(403, "PERMISSION_REQUIRED", "Staff capacity required");
  }
  const transport = getUserSessionCookieToken(request) ? "cookie" : "bearer";
  cacheAdminForRequest(request, userSession.staff, transport);
  return userSession.staff;
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
