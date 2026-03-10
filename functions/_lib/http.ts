import { isAppError } from "./errors";

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  const mergedHeaders = {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  };

  return new Response(JSON.stringify(data), {
    status,
    headers: mergedHeaders,
  });
}

export function jsonNoStore(data: unknown, status = 200, headers?: HeadersInit): Response {
  return json(data, status, {
    "cache-control": "no-store, max-age=0",
    ...headers,
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/**
 * Mark a Pages Function context as sensitive so the middleware applies
 * `no-store` cache control to every response (including error responses
 * that are caught and returned by the middleware's catch block).
 *
 * Call this once at the top of the route's `onRequest` (or the specific
 * method handler) instead of listing URL patterns in the middleware.
 */
export function markSensitive(context: { data?: Record<string, unknown> }): void {
  if (!context.data) {
    context.data = {};
  }
  context.data["sensitive"] = true;
}

export function handleError(error: unknown): Response {
  if (isAppError(error)) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
      error.status,
    );
  }

  const message = error instanceof Error ? error.message : "Unknown error";
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    },
    500,
  );
}
