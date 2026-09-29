import { hasAuthenticationCredential } from "../auth/session-cookies";

/** Only routes with a public, caller-independent projection enter the cached entrypoint. */
export function isPublicReadCacheCandidate(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (hasAuthenticationCredential(request)) return false;

  const { pathname, searchParams } = new URL(request.url);
  if (searchParams.get("view") === "staff") return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  return (
    path === "/api" ||
    path === "/api/v1" ||
    path === "/api/v1/members" ||
    path === "/api/v1/members/wall" ||
    (/^\/api\/v1\/members\/[^/]+$/.test(path) &&
      !["capacities", "applications", "join"].includes(path.split("/").at(-1)!)) ||
    path === "/api/v1/sponsors" ||
    path === "/api/v1/sponsors/display" ||
    path === "/api/v1/sponsors/tiers" ||
    path === "/api/v1/events" ||
    /^\/api\/v1\/events\/[^/]+$/.test(path) ||
    /^\/api\/v1\/events\/[^/]+\/terms$/.test(path) ||
    path === "/api/v1/votes" ||
    path === "/api/v1/votes/feed.rss" ||
    /^\/api\/v1\/votes\/[^/]+$/.test(path) ||
    /^\/api\/v1\/groups\/[^/]+\/directory$/.test(path) ||
    ["/news", "/news/index.html", "/news/feed", "/news/feed/index.xml"].includes(path) ||
    (/^\/members\/[^/.]+$/.test(path) && !["profile", "independent"].includes(path.split("/").at(-1)!))
  );
}

/** Never let a response without an explicit public policy populate Workers Cache. */
export function publicReadCacheResponse(response: Response): Response {
  const result = new Response(response.body, response);
  const policy = result.headers.get("cache-control") ?? "";
  if (!response.ok || !/(?:^|,)\s*public(?:\s*,|$)/i.test(policy) || result.headers.has("set-cookie")) {
    result.headers.delete("cloudflare-cdn-cache-control");
    result.headers.delete("cdn-cache-control");
    result.headers.set("cache-control", "no-store, max-age=0");
  }
  result.headers.delete("x-request-id");
  result.headers.delete("cf-cache-status");
  return result;
}
