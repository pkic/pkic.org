import type { DatabaseLike, Env } from "../types";

export const REQUEST_DB_CONTEXT_KEY = "requestDb";
export const SENSITIVE_CONTEXT_KEY = "sensitive";
type ContextKey = typeof REQUEST_DB_CONTEXT_KEY | typeof SENSITIVE_CONTEXT_KEY;

export type RequestDbContext = {
  Bindings: Env;
  Variables: {
    [REQUEST_DB_CONTEXT_KEY]?: DatabaseLike;
    [SENSITIVE_CONTEXT_KEY]?: boolean;
  };
};

export interface AdminContext<P extends Record<string, string> = Record<string, string>> {
  env: Env;
  req: {
    raw: Request;
    param(name: string): string;
    param(): P;
    parseBody?: () => Promise<Record<string, unknown>>;
  };
  executionCtx: {
    waitUntil(promise: Promise<unknown>): void;
  };
  var?: {
    [REQUEST_DB_CONTEXT_KEY]?: DatabaseLike;
    [SENSITIVE_CONTEXT_KEY]?: boolean;
  };
  get?: (key: ContextKey) => unknown;
  set?: (key: ContextKey, value: DatabaseLike | boolean) => void;
}

type RequestDbCarrier = Pick<AdminContext, "env"> &
  Partial<Pick<AdminContext, "var">> & {
    get?: (key: typeof REQUEST_DB_CONTEXT_KEY) => unknown;
  };

export function requestDb(c: RequestDbCarrier): DatabaseLike {
  return c.var?.requestDb ?? (c.get?.(REQUEST_DB_CONTEXT_KEY) as DatabaseLike | undefined) ?? c.env.DB;
}

/**
 * Marks the response private for a route whose path is not covered by the
 * middleware's staff-only prefixes. It applies `no-store` and the private
 * response headers even when the request carries no session, so an
 * unauthorized attempt is not treated as a cacheable public response.
 */
export function markResponseSensitive(c: Pick<AdminContext, "set">): void {
  c.set?.(SENSITIVE_CONTEXT_KEY, true);
}
