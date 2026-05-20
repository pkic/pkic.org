import type { DatabaseLike, Env } from "../types";

export const REQUEST_DB_CONTEXT_KEY = "requestDb";

export type RequestDbContext = {
  Bindings: Env;
  Variables: {
    [REQUEST_DB_CONTEXT_KEY]?: DatabaseLike;
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
  };
  get?: (key: typeof REQUEST_DB_CONTEXT_KEY) => unknown;
  set?: (key: typeof REQUEST_DB_CONTEXT_KEY, value: DatabaseLike) => void;
}

type RequestDbCarrier = Pick<AdminContext, "env"> &
  Partial<Pick<AdminContext, "var">> & {
    get?: (key: typeof REQUEST_DB_CONTEXT_KEY) => unknown;
  };

export function requestDb(c: RequestDbCarrier): DatabaseLike {
  return c.var?.requestDb ?? (c.get?.(REQUEST_DB_CONTEXT_KEY) as DatabaseLike | undefined) ?? c.env.DB;
}
