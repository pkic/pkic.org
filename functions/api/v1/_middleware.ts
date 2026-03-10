import { handleError } from "../../_lib/http";
import type { PagesContext } from "../../_lib/types";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";
const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";

function isPublicCacheableGet(pathname: string): boolean {
  return /^\/api\/v1\/events\/[^/]+\/terms$/.test(pathname);
}

/**
 * Returns true for routes that are architecturally admin/internal and must
 * never be cached regardless of whether the handler calls markSensitive().
 * All other routes signal sensitivity by calling markSensitive(context) at
 * the top of their handler so the middleware reads it from context.data.
 */
function isAdminPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/v1/admin/") ||
    pathname.startsWith("/api/v1/internal/")
  );
}

function applyCachePolicy(
  request: Request,
  response: Response,
  contextData?: Record<string, unknown>,
): void {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();
  const hasAuthHeader = Boolean(request.headers.get("authorization"));
  const sensitive =
    hasAuthHeader ||
    isAdminPath(pathname) ||
    contextData?.["sensitive"] === true;

  if (sensitive || !["GET", "HEAD"].includes(method)) {
    response.headers.set("cache-control", NO_STORE_CACHE_CONTROL);
    return;
  }

  if (isPublicCacheableGet(pathname)) {
    response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const requestId = context.request.headers.get("x-request-id") ?? crypto.randomUUID();

  try {
    if (!context.next) {
      return new Response("Middleware misconfiguration", { status: 500 });
    }

    const response = await context.next();
    applyCachePolicy(context.request, response, context.data);
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error) {
    const response = handleError(error);
    applyCachePolicy(context.request, response, context.data);
    response.headers.set("x-request-id", requestId);
    return response;
  }
}
