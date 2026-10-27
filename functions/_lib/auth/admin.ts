import { userSessionRequestAuthorizationEvidence } from "./user-session-evidence";
import {
  userSessionActingIdentitySelection,
  userSessionMemberSelection,
  userSessionAuthorizationEvidence,
} from "./identity-capacities";
import { activeOauthAuthorizationSql } from "./oauth/authorization-ceiling-query";
import type { AuthorizationEvidence } from "../db/authorization-guard";
import { prepareActiveOauthAuthorization } from "./oauth/authorization-ceiling";
import { effectiveMcpPermissionContexts } from "./oauth/grantable-permissions";
import { permissionSchema } from "../../../assets/shared/schemas/permissions";
import { activeUserCapacityDefinitions } from "../services/membership/capacity-query";
import { AppError } from "../errors";
import { batchFirst, batchRows } from "../db/pagination";
import { constantTimeEqual } from "../utils/crypto";
import { AUTH_SCOPES } from "./scopes";
import { prepareUserGrantCandidates, selectUserGrantCandidates, type ContextGrantRow } from "./permissions";
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
  selected_member_id: string | null;
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
    const read = await prepareMcpAdminRequest(db, request, credential.token, env);
    return read.decode(await db.batch(read.statements));
  }

  const read = await prepareHumanAdminRequest(db, request, env);
  return read.decode(await db.batch(read.statements));
}

type AdminEnvironment = Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">;
export interface PreparedAdminRead {
  subjectId: string;
  permissionActor: UserBackedAuthAdmin;
  authorizationEvidence: AuthorizationEvidence;
  memberSelection?: AuthorizationEvidence;
  actingIdentitySelection?: AuthorizationEvidence;
  sessionId?: string;
  statements: StatementLike[];
  decode(results: D1StatementResult[]): Promise<UserBackedAuthAdmin>;
}

const requestAdminKey = Symbol("prepared-request-admin");
type PreparedRequestAdminEnvironment = AdminEnvironment & {
  [requestAdminKey]?: { request: Request; read: PreparedAdminRead };
};
/** Trusted request-owned context; no header or client value can install prepared authority. */
export function withPreparedRequestAdmin<T extends object>(env: T, request: Request, read: PreparedAdminRead): T {
  return { ...env, [requestAdminKey]: { request, read } };
}
/** Canonical transport selection; an explicit human credential takes precedence over machine headers. */
export async function readAdminCredential(
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
    subjectId: read.claims.sub,
    permissionActor: createUserBackedAuthAdmin({
      id: read.claims.sub,
      email: "",
      scopes: [],
      sessionId: read.claims.sid,
    }),
    authorizationEvidence: userSessionRequestAuthorizationEvidence(read.claims, true),
    memberSelection: userSessionMemberSelection(read.claims.sub, read.claims.iid),
    actingIdentitySelection: userSessionActingIdentitySelection(read.claims.sub, read.claims.iid),
    sessionId: read.claims.sid,
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
  const prepared = (env as PreparedRequestAdminEnvironment | undefined)?.[requestAdminKey];
  if (prepared?.request === request) return prepared.read;
  const cached = getCachedAdminForRequest(request);
  if (cached) {
    const actor = requireUserBackedAuthAdmin(cached);
    return {
      subjectId: actor.id,
      sessionId: actor.sessionId,
      permissionActor: actor,
      authorizationEvidence: actor.sessionId
        ? userSessionAuthorizationEvidence(actor.id, actor.sessionId)
        : { sql: "SELECT 1 WHERE 0", bindings: [] },
      statements: [],
      decode: async () => actor,
    };
  }
  const credential = await readAdminCredential(request, env);
  if (credential.kind === "mcp") return prepareMcpAdminRequest(db, request, credential.token, env);
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
  const read = prepareCurrentUserBackedAdmin(db, userId, sessionId, memberId);
  return read.decode(await db.batch(read.statements));
}

/** Live session and all grant candidates compose with OAuth and resource snapshots. */
export function prepareCurrentUserBackedAdmin(
  db: DatabaseLike,
  userId: string,
  sessionId: string,
  member: string | null | { authorizationId: string } = null,
) {
  const chosen =
    typeof member === "object" && member
      ? { sql: "SELECT member_id FROM oauth_authorizations WHERE id=?", bindings: [member.authorizationId] }
      : { sql: "SELECT ? AS member_id", bindings: [member] };
  return {
    statements: [
      db
        .prepare(
          `WITH chosen AS(${chosen.sql}) SELECT s.id,s.user_id,s.expires_at,s.revoked_at,u.email,chosen.member_id AS selected_member_id FROM sessions s JOIN users u ON u.id=s.user_id CROSS JOIN chosen WHERE s.id=? AND s.user_id=? AND u.active=1 AND ${STAFF_ACCESS_CONDITION} AND (chosen.member_id IS NULL OR EXISTS(WITH ${activeUserCapacityDefinitions("SELECT u.id")} SELECT 1 FROM active_user_capacities WHERE member_id=chosen.member_id))`,
        )
        .bind(...chosen.bindings, sessionId, userId),
      prepareUserGrantCandidates(db, [userId]),
    ],
    decode(loaded: D1StatementResult[]) {
      const session = batchFirst<AdminSessionRow>(loaded[0]);
      try {
        assertSessionActive(session ? { revokedAt: session.revoked_at, expiresAt: session.expires_at } : null, "admin");
      } catch {
        return null;
      }
      return createUserBackedAuthAdmin({
        id: session!.user_id,
        email: session!.email,
        scopes: [],
        grants: selectUserGrantCandidates(batchRows<ContextGrantRow>(loaded[1]), 0, session!.selected_member_id),
        memberId: session!.selected_member_id,
        sessionId: session!.id,
        expiresAt: session!.expires_at,
      });
    },
  };
}
async function prepareMcpAdminRequest(
  db: DatabaseLike,
  request: Request,
  token: string,
  env?: AdminEnvironment,
): Promise<PreparedAdminRead> {
  if (!env?.INTERNAL_SIGNING_SECRET)
    throw new AppError(500, "INTERNAL_SECRET_MISSING", "INTERNAL_SIGNING_SECRET is not configured");
  const verified = await verifyMcpSessionToken(env.INTERNAL_SIGNING_SECRET, token);
  if (!verified.ok)
    throw new AppError(
      401,
      verified.reason === "expired" ? "AUTH_EXPIRED" : "AUTH_INVALID",
      verified.reason === "expired" ? "MCP session expired" : "Invalid MCP session token",
    );
  const claims = verified.claims;
  const authorization = claims.authorizationId
    ? prepareActiveOauthAuthorization(db, { id: claims.authorizationId, userId: claims.sub, sessionId: claims.sid })
    : null;
  const live = prepareCurrentUserBackedAdmin(
    db,
    claims.sub,
    claims.sid,
    claims.authorizationId ? { authorizationId: claims.authorizationId } : null,
  );
  const liveEvidence = userSessionAuthorizationEvidence(claims.sub, claims.sid);
  const permissionActor = createUserBackedAuthAdmin({
    id: claims.sub,
    email: claims.email,
    sessionId: claims.sid,
    scopes: claims.scopes,
    scopeRestricted: true,
    ...(claims.authorizationId ? { oauthAuthorizationId: claims.authorizationId } : {}),
  });
  const authorizationEvidence = {
    sql: `SELECT 1 FROM users u WHERE u.id=? AND u.active=1 AND u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL AND ${STAFF_ACCESS_CONDITION} AND EXISTS(${liveEvidence.sql}) ${claims.authorizationId ? `AND EXISTS(SELECT 1 FROM oauth_authorizations authorization WHERE authorization.id=? AND authorization.user_id=u.id AND authorization.session_id=? AND ${activeOauthAuthorizationSql("authorization")})` : ""}`,
    bindings: [
      claims.sub,
      ...liveEvidence.bindings,
      ...(claims.authorizationId ? [claims.authorizationId, claims.sid] : []),
    ],
  };
  return {
    subjectId: claims.sub,
    permissionActor,
    authorizationEvidence,
    ...(claims.authorizationId
      ? {
          actingIdentitySelection: {
            sql: "SELECT identity_id FROM oauth_authorizations WHERE id=?",
            bindings: [claims.authorizationId],
          },
          memberSelection: {
            sql: "SELECT member_id FROM oauth_authorizations WHERE id=?",
            bindings: [claims.authorizationId],
          },
        }
      : {}),
    sessionId: claims.sid,
    statements: [...(authorization?.statements ?? []), ...live.statements],
    async decode(loaded) {
      const ceiling = authorization?.decode(loaded.slice(0, authorization.statements.length));
      const actor = live.decode(loaded.slice(authorization?.statements.length ?? 0));
      if (!actor) throw new AppError(401, "AUTH_INVALID", "MCP session is no longer active");
      const admin = createUserBackedAuthAdmin({
        ...actor,
        scopes: claims.scopes,
        ...(ceiling
          ? {
              oauthAuthorizationId: ceiling.id,
              grants: effectiveMcpPermissionContexts(
                actor,
                ceiling.scopes,
                claims.scopes.flatMap((scope) => {
                  const parsed = permissionSchema.safeParse(scope);
                  return parsed.success ? [parsed.data] : [];
                }),
              ),
            }
          : {}),
        scopeRestricted: true,
        state: claims.state ?? null,
      });
      cacheAdminForRequest(request, admin, "bearer");
      return admin;
    },
  };
}
