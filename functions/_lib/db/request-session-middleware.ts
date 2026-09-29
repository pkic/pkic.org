import type { Context, MiddlewareHandler, Next } from "hono";
import { getCachedAdminAuthTransport, getCachedAdminForRequest, requireAdminFromRequest } from "../auth/admin";
import {
  getUserSessionToken,
  USER_SESSION_TOKEN_HEADER,
  serializeUserSessionCookie,
  signUserSessionToken,
  verifyUserSessionToken,
} from "../auth/user-session";
import { signMcpSessionToken, verifyMcpSessionToken } from "../auth/mcp-session";
import { getBearerToken } from "../auth/session-engine";
import { isUserBackedAuthAdmin } from "../auth/admin-identity";
import { REQUEST_DB_CONTEXT_KEY, type RequestDbContext } from "./context";
import { primaryFirstDb, readReplicaDb, type DatabaseSessionLike } from "./session";

export interface RequestSessionMiddlewareOptions {
  /**
   * Called after staff authentication on the primary binding, before the
   * route uses the request-scoped D1 session.
   */
  authorize?: (c: Context<RequestDbContext>) => void | Promise<void>;
}

function bookmarkFromAdmin(c: Context<RequestDbContext>): string | null {
  const admin = getCachedAdminForRequest(c.req.raw);
  const state = admin && isUserBackedAuthAdmin(admin) ? admin.state : null;
  return state && state.length > 0 && state.length < 1024 ? state : null;
}

async function rotateSessionState(c: Context<RequestDbContext>, sessionDb: DatabaseSessionLike): Promise<void> {
  const state = sessionDb.getBookmark?.();
  const admin = getCachedAdminForRequest(c.req.raw);
  const transport = getCachedAdminAuthTransport(c.req.raw);
  if (
    !state ||
    !admin ||
    !isUserBackedAuthAdmin(admin) ||
    !admin.sessionId ||
    !admin.expiresAt ||
    !c.env.INTERNAL_SIGNING_SECRET ||
    transport === "api-key"
  ) {
    return;
  }

  const userToken = getUserSessionToken(c.req.raw);
  const verified =
    userToken && c.env.INTERNAL_SIGNING_SECRET
      ? await verifyUserSessionToken(c.env.INTERNAL_SIGNING_SECRET, userToken)
      : null;
  if (verified?.ok) {
    const token = await signUserSessionToken(c.env.INTERNAL_SIGNING_SECRET, {
      sub: admin.id,
      sid: admin.sessionId,
      exp: verified.claims.exp,
      identityId: verified.claims.iid,
      state,
    });
    const headers = new Headers(c.res.headers);
    if (transport === "cookie") {
      headers.append("Set-Cookie", serializeUserSessionCookie(token, c.req.raw));
    } else {
      headers.set(USER_SESSION_TOKEN_HEADER, token);
    }
    c.res = new Response(c.res.body, { status: c.res.status, headers });
    return;
  }

  const mcpToken = getBearerToken(c.req.raw);
  const verifiedMcp = mcpToken ? await verifyMcpSessionToken(c.env.INTERNAL_SIGNING_SECRET, mcpToken) : null;
  if (verifiedMcp?.ok) {
    const token = await signMcpSessionToken(c.env.INTERNAL_SIGNING_SECRET, {
      ...verifiedMcp.claims,
      state,
    });
    const headers = new Headers(c.res.headers);
    headers.set("x-mcp-token", token);
    c.res = new Response(c.res.body, { status: c.res.status, headers });
  }
}

/**
 * Authenticates staff against primary D1, then scopes route reads to the
 * caller's D1 bookmark and writes to first-primary. The environment binding
 * is never mutated; downstream code reads `requestDb(c)`.
 */
export function createRequestScopedD1SessionMiddleware(
  options: RequestSessionMiddlewareOptions = {},
): MiddlewareHandler<RequestDbContext> {
  return async (c, next: Next): Promise<void> => {
    const isWrite = c.req.method !== "GET" && c.req.method !== "HEAD";
    const primaryDb = c.env.DB;
    let sessionDb: DatabaseSessionLike;

    if (isWrite) {
      sessionDb = primaryFirstDb(primaryDb);
      c.set(REQUEST_DB_CONTEXT_KEY, sessionDb);
      await requireAdminFromRequest(primaryDb, c.req.raw, c.env);
      await options.authorize?.(c);
    } else {
      await requireAdminFromRequest(primaryDb, c.req.raw, c.env);
      await options.authorize?.(c);
      sessionDb = readReplicaDb(primaryDb, bookmarkFromAdmin(c));
      c.set(REQUEST_DB_CONTEXT_KEY, sessionDb);
    }

    await next();
    await rotateSessionState(c, sessionDb).catch((error) => {
      console.error("[request-session] Failed to rotate D1 bookmark:", error);
    });
  };
}
