import { hasAuthenticationCredential } from "../auth/session-cookies";
import type { Env } from "../types";
import { OpenAPIRoute } from "chanfana";

const DEFAULT_BROWSER_TTL_SECONDS = 3600;
const DEFAULT_CDN_TTL_SECONDS = 86400;

function ttl(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Authenticate before consulting the shared cache; the response policy decides what is public. */
export function isAnonymousReadRequest(request: Request): boolean {
  return (request.method === "GET" || request.method === "HEAD") && !hasAuthenticationCredential(request);
}

/** Route registration opts a successful, caller-independent read into the shared policy. */
export function markPublicRead(request: Request, response: Response, sensitive = false): Response {
  if (!isAnonymousReadRequest(request) || sensitive || response.status !== 200 || response.headers.has("set-cookie")) {
    return response;
  }
  if (/\b(?:private|no-store|no-cache)\b/i.test(response.headers.get("cache-control") ?? "")) return response;
  const result = new Response(response.body, response);
  result.headers.set("cache-control", "public");
  return result;
}

export function publicReadRoute<Route extends typeof OpenAPIRoute>(route: Route): Route {
  const BaseRoute: typeof OpenAPIRoute = route;
  return class extends BaseRoute {
    async handle(context: any): Promise<Response> {
      const response = (await super.handle(context)) as Response;
      return markPublicRead(context.req.raw, response, context.get?.("sensitive") === true);
    }
  } as Route;
}

/** Never let a response without an explicit public policy populate Workers Cache. */
export async function publicReadCacheResponse(response: Response, env: Env): Promise<Response> {
  const result = new Response(response.body, response);
  const policy = result.headers.get("cache-control") ?? "";
  if (
    response.status !== 200 ||
    !/(?:^|,)\s*public(?:\s*,|$)/i.test(policy) ||
    /(?:^|,)\s*(?:private|no-store|no-cache)(?:\s*,|$)/i.test(policy) ||
    result.headers.has("set-cookie")
  ) {
    result.headers.delete("cloudflare-cdn-cache-control");
    result.headers.delete("cdn-cache-control");
    result.headers.set("cache-control", "no-store, max-age=0");
  } else if (policy.trim().toLowerCase() === "public") {
    result.headers.set(
      "cache-control",
      `public, max-age=${ttl(env.PUBLIC_READ_BROWSER_TTL_SECONDS, DEFAULT_BROWSER_TTL_SECONDS)}`,
    );
    if (!result.headers.has("cloudflare-cdn-cache-control") && !result.headers.has("cdn-cache-control")) {
      result.headers.set(
        "cloudflare-cdn-cache-control",
        `public, max-age=${ttl(env.PUBLIC_READ_CDN_TTL_SECONDS, DEFAULT_CDN_TTL_SECONDS)}`,
      );
    }
    if (
      !result.headers.has("etag") &&
      result.body &&
      /^(?:application\/(?:json|[^;]+\+json|rss\+xml|xml)|text\/)/i.test(result.headers.get("content-type") ?? "")
    ) {
      const bytes = await result.clone().arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      result.headers.set(
        "etag",
        `"${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`,
      );
    }
  }
  result.headers.delete("x-request-id");
  result.headers.delete("cf-cache-status");
  return result;
}

/** Conditional browser requests are answered after the CDN lookup. */
export function conditionalPublicReadResponse(request: Request, response: Response): Response {
  const etag = response.headers.get("etag");
  const conditions = request.headers.get("if-none-match");
  if (!etag || !conditions || response.status !== 200 || !["GET", "HEAD"].includes(request.method)) return response;
  const normalizedEtag = etag.replace(/^W\//, "");
  if (
    !conditions.split(",").some((value) => value.trim().replace(/^W\//, "") === normalizedEtag || value.trim() === "*")
  ) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(null, { status: 304, headers });
}
