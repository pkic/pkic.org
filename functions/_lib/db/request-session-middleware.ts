import type { Context, MiddlewareHandler, Next } from "hono";
import {
  getCachedAdminAuthTransport,
  getCachedAdminForRequest,
  requireAdminFromRequest,
  serializeAdminSessionCookie,
  signAdminSessionToken,
} from "../auth/admin";
import { isUserBackedAuthAdmin } from "../auth/admin-identity";
import { REQUEST_DB_CONTEXT_KEY, type RequestDbContext } from "./context";
import { primaryFirstDb, readReplicaDb, type DatabaseSessionLike } from "./session";

const ADMIN_TOKEN_HEADER = "x-admin-token";

export interface RequestSessionMiddlewareOptions {
  /**
   * Called after staff authentication on the primary binding, before the
   * route uses the request-scoped D1 session. Use for legacy route policy.
   */
  authorize?: (c: Context<RequestDbContext>) => void | Promise<void>;
  /** Legacy authentication endpoints create sessions and must remain public. */
  skipAuthorization?: (c: Context<RequestDbContext>) => boolean;
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

  const token = await signAdminSessionToken(c.env.INTERNAL_SIGNING_SECRET, {
    admin,
    sessionId: admin.sessionId,
    expiresAt: admin.expiresAt,
    state,
  });
  const headers = new Headers(c.res.headers);
  if (transport === "cookie") {
    headers.append("Set-Cookie", serializeAdminSessionCookie(token, c.req.raw));
  } else {
    headers.set(ADMIN_TOKEN_HEADER, token);
  }
  c.res = new Response(c.res.body, { status: c.res.status, headers });
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
    const skipAuthorization = options.skipAuthorization?.(c) ?? false;
    const primaryDb = c.env.DB;
    let sessionDb: DatabaseSessionLike;

    if (isWrite) {
      sessionDb = primaryFirstDb(primaryDb);
      c.set(REQUEST_DB_CONTEXT_KEY, sessionDb);
      if (!skipAuthorization) {
        await requireAdminFromRequest(primaryDb, c.req.raw, c.env);
        await options.authorize?.(c);
      }
    } else {
      await requireAdminFromRequest(primaryDb, c.req.raw, c.env);
      if (!skipAuthorization) await options.authorize?.(c);
      sessionDb = readReplicaDb(primaryDb, bookmarkFromAdmin(c));
      c.set(REQUEST_DB_CONTEXT_KEY, sessionDb);
    }

    await next();
    await rotateSessionState(c, sessionDb).catch((error) => {
      console.error("[request-session] Failed to rotate D1 bookmark:", error);
    });
  };
}
