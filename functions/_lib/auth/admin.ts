import { readActiveOauthAuthorization } from "./oauth/authorization-ceiling";
import { effectiveMcpPermissionContexts } from "./oauth/grantable-permissions";
import { permissionSchema } from "../../../assets/shared/schemas/permissions";
import { activeUserCapacityDefinitions } from "../services/membership/capacity-query";
import { AppError } from "../errors";
import { first } from "../db/queries";
import { constantTimeEqual } from "../utils/crypto";
import { AUTH_SCOPES } from "./scopes";
import { computeGrantsForUser } from "./permissions";
import type { AuthAdmin, DatabaseLike, Env, UserBackedAuthAdmin, StatementLike, D1StatementResult } from "../types";
import { createServiceAuthAdmin, createUserBackedAuthAdmin, requireUserBackedAuthAdmin } from "./admin-identity";
import { assertSessionActive, getBearerToken } from "./session-engine";
import { getUserSessionCookieToken, USER_SESSION_TOKEN_HEADER } from "./user-session";
import { prepareUserSessionRequest } from "./user-session-request";
import { verifyMcpSessionToken } from "./mcp-session";
import { STAFF_ACCESS_CONDITION } from "./identity-capacities";

/** Live staff capacity projected from the canonical human user session. */
interface AdminSessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  revoked_at: string | null;
  email: string;
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

  const credential = await readAdminCredential(request, env);
  // API keys remain explicit service identities and never enter the human verifier.
  if (credential.kind === "api-key") {
    const admin = createServiceAuthAdmin({
      id: "api-key",
      email: "api-key",
      role: "admin",
      scopes: [...AUTH_SCOPES],
    });
    cacheAdminForRequest(request, admin, "api-key");
    return admin;
  }

  if (credential.kind === "mcp") {
    const internalSecret = env?.INTERNAL_SIGNING_SECRET;
    if (!internalSecret) {
      throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
    }
    const mcpVerified = await verifyMcpSessionToken(internalSecret, credential.token);
    if (!mcpVerified.ok) {
      throw new AppError(
        401,
        mcpVerified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
        mcpVerified.reason === "expired" ? "MCP session expired" : "Invalid MCP session token",
      );
    }
    const authorization = mcpVerified.claims.authorizationId
      ? await readActiveOauthAuthorization(db, {
          id: mcpVerified.claims.authorizationId,
          userId: mcpVerified.claims.sub,
          sessionId: mcpVerified.claims.sid,
        })
      : null;
    const liveAdmin = await getCurrentUserBackedAdmin(
      db,
      mcpVerified.claims.sub,
      mcpVerified.claims.sid,
      authorization?.memberId,
    );
    if (!liveAdmin) throw new AppError(401, "AUTH_INVALID", "MCP session is no longer active");
    const admin = createUserBackedAuthAdmin({
      ...liveAdmin,
      scopes: mcpVerified.claims.scopes,
      ...(authorization
        ? {
            oauthAuthorizationId: authorization.id,
            grants: effectiveMcpPermissionContexts(
              liveAdmin,
              authorization.scopes,
              mcpVerified.claims.scopes.flatMap((scope) => {
                const parsed = permissionSchema.safeParse(scope);
                return parsed.success ? [parsed.data] : [];
              }),
            ),
          }
        : {}),
      scopeRestricted: true,
      state: mcpVerified.claims.state ?? null,
    });
    cacheAdminForRequest(request, admin, "bearer");
    return admin;
  }

  const read = await prepareHumanAdminRequest(db, request, env);
  return read.decode(await db.batch(read.statements));
}

type AdminEnvironment = Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">;
interface PreparedAdminRead {
  statements: StatementLike[];
  decode(results: D1StatementResult[]): Promise<UserBackedAuthAdmin>;
}

/** Canonical transport selection; an explicit human credential takes precedence over machine headers. */
async function readAdminCredential(
  request: Request,
  env?: AdminEnvironment,
): Promise<{ kind: "api-key" | "user" } | { kind: "mcp"; token: string }> {
  const explicitUserTransport = Boolean(
    request.headers.get(USER_SESSION_TOKEN_HEADER) || getUserSessionCookieToken(request),
  );
  const token = getBearerToken(request);
  if (!token && !explicitUserTransport) throw new AppError(401, "AUTH_REQUIRED", "Missing bearer token");
  if (!explicitUserTransport && token && env?.ADMIN_API_KEY && (await constantTimeEqual(token, env.ADMIN_API_KEY)))
    return { kind: "api-key" };
  if (!explicitUserTransport && request.headers.get(MACHINE_AUTH_HEADER) === "mcp")
    return { kind: "mcp", token: token! };
  return { kind: "user" };
}

async function prepareHumanAdminRequest(
  db: DatabaseLike,
  request: Request,
  env?: AdminEnvironment,
): Promise<PreparedAdminRead> {
  const read = await prepareUserSessionRequest(db, request, { INTERNAL_SIGNING_SECRET: env?.INTERNAL_SIGNING_SECRET });
  return {
    statements: read.statements,
    async decode(results) {
      const session = await read.decode(results);
      if (!session.staff) throw new AppError(403, "PERMISSION_REQUIRED", "Staff capacity required");
      cacheAdminForRequest(request, session.staff, getUserSessionCookieToken(request) ? "cookie" : "bearer");
      return session.staff;
    },
  };
}

/** Compose human authentication with resource reads. Delegated OAuth/MCP keeps its canonical resolver. */
export async function prepareUserBackedAdminFromRequest(
  db: DatabaseLike,
  request: Request,
  env?: AdminEnvironment,
): Promise<PreparedAdminRead | null> {
  const cached = getCachedAdminForRequest(request);
  if (cached) {
    const actor = requireUserBackedAuthAdmin(cached);
    return { statements: [], decode: async () => actor };
  }
  const credential = await readAdminCredential(request, env);
  if (credential.kind !== "user") return null;
  return prepareHumanAdminRequest(db, request, env);
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
  memberId: string | null = null,
): Promise<UserBackedAuthAdmin | null> {
  const session = await first<AdminSessionRow>(
    db,
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.email
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.user_id = ? AND u.active = 1 AND ${STAFF_ACCESS_CONDITION}
        ${
          memberId
            ? `AND EXISTS(WITH ${activeUserCapacityDefinitions("SELECT u.id")}
          SELECT 1 FROM active_user_capacities WHERE member_id=?)`
            : ""
        }`,
    [sessionId, userId, ...(memberId ? [memberId] : [])],
  );
  try {
    assertSessionActive(session ? { revokedAt: session.revoked_at, expiresAt: session.expires_at } : null, "admin");
  } catch {
    return null;
  }

  return createUserBackedAuthAdmin({
    id: session!.user_id,
    email: session!.email,
    scopes: [],
    grants: await computeGrantsForUser(db, session!.user_id, memberId),
    memberId,
    sessionId: session!.id,
    expiresAt: session!.expires_at,
  });
}
