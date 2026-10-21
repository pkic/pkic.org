import type { Context, MiddlewareHandler } from "hono";
import { requireAdminFromRequest } from "../auth/admin";
import { requestDb, REQUEST_DB_CONTEXT_KEY, type RequestDbContext } from "./context";
import { withRequestD1Session } from "./request-session";

export interface RequestSessionMiddlewareOptions {
  /** Called after staff authentication in the request's D1 session. */
  authorize?: (c: Context<RequestDbContext>) => void | Promise<void>;
}

/** Reuse the invocation session; direct router callers establish the same boundary. */
export function createRequestScopedD1SessionMiddleware(
  options: RequestSessionMiddlewareOptions = {},
): MiddlewareHandler<RequestDbContext> {
  return async (c, next): Promise<void> => {
    c.res = await withRequestD1Session(c.req.raw, c.env, async (env) => {
      c.set(REQUEST_DB_CONTEXT_KEY, env.DB);
      await requireAdminFromRequest(requestDb(c), c.req.raw, env);
      await options.authorize?.(c);
      await next();
      return c.res;
    });
  };
}
