import { hasAuthenticatedSessionCookie } from "../../_lib/auth/session-cookies";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";
const NO_STORE_CACHE_CONTROL = "no-store, max-age=0";

function isPublicCacheableGet(pathname: string): boolean {
  return /^\/api\/v1\/events\/[^/]+\/terms$/.test(pathname);
}

/**
 * Returns true for staff-only and internal route families that must never be
 * cached regardless of whether the handler calls markSensitive().
 * All other routes signal sensitivity by calling markSensitive(context) at
 * the top of their handler so the middleware reads it from context.data.
 */
function isSensitiveArchitecturePath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/v1/admin/") ||
    pathname.startsWith("/api/v1/analytics/") ||
    pathname === "/api/v1/audit-log" ||
    pathname.startsWith("/api/v1/audit-log/") ||
    pathname.startsWith("/api/v1/email/") ||
    pathname.startsWith("/api/v1/internal/") ||
    pathname.startsWith("/api/v1/membership/") ||
    pathname.startsWith("/api/v1/operations/") ||
    pathname.startsWith("/api/v1/system/")
  );
}

function applyResponsePolicy(request: Request, response: Response, sensitive?: boolean): void {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();
  const hasAuthHeader = Boolean(request.headers.get("authorization"));
  const hasAuthCookie = hasAuthenticatedSessionCookie(request);
  const isSensitive = hasAuthHeader || hasAuthCookie || isSensitiveArchitecturePath(pathname) || sensitive === true;

  if (isSensitive || !["GET", "HEAD"].includes(method)) {
    response.headers.set("cache-control", NO_STORE_CACHE_CONTROL);
  } else if (isPublicCacheableGet(pathname)) {
    response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  }

  if (isSensitive) {
    response.headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    response.headers.set("referrer-policy", "no-referrer");
    response.headers.set("x-content-type-options", "nosniff");
    response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  }
}

function ensureMutableResponse(response: Response): Response {
  try {
    response.headers.set("x-response-mutable-check", "1");
    response.headers.delete("x-response-mutable-check");
    return response;
  } catch {
    return new Response(response.body, response);
  }
}

export function finalizeApiResponse(
  request: Request,
  response: Response,
  sensitive = false,
  requestId?: string,
): Response {
  const mutableResponse = ensureMutableResponse(response);
  applyResponsePolicy(request, mutableResponse, sensitive);
  if (requestId) {
    mutableResponse.headers.set("x-request-id", requestId);
  }
  return mutableResponse;
}

export async function onRequest(c: any, next?: () => Promise<void>): Promise<Response> {
  const isHonoContext = Boolean(c?.req?.raw);
  const request = (isHonoContext ? c.req.raw : c.request) as Request;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  if (isHonoContext) {
    c.set("requestId", requestId);
  } else {
    c.data = c.data ?? {};
    c.data.requestId = requestId;
  }
  const runNext =
    next ??
    (async () => {
      const response = await c.next?.();
      if (isHonoContext && response) {
        c.res = response;
      }
    });

  await runNext();
  return finalizeApiResponse(
    request,
    isHonoContext ? c.res : await c.next(),
    isHonoContext ? c.get("sensitive") === true : c.data?.sensitive === true,
    requestId,
  );
}
