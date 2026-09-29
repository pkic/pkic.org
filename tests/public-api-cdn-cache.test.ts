import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { isPublicReadCacheCandidate, publicReadCacheResponse } from "../functions/_lib/cache/public-read";
import worker from "../functions/router";

describe("public API CDN cache gateway", () => {
  it("returns the cached entrypoint response without running the API handler", async () => {
    let calls = 0;
    const ctx = {
      exports: {
        PublicRead: {
          async fetch() {
            calls++;
            return new Response("cached", { headers: { "cf-cache-status": "HIT" } });
          },
        },
      },
    } as unknown as ExecutionContext;

    const response = await worker.fetch(new Request("https://pkic.org/api/v1/members"), env, ctx);
    expect(await response.text()).toBe("cached");
    expect(response.headers.get("cf-cache-status")).toBe("HIT");
    expect(calls).toBe(1);
  });

  it.each([
    "/api/v1/members?group=organization&sort=name&limit=50&offset=0",
    "/api/v1/members/member-1",
    "/api/v1/members/wall",
    "/api/v1/sponsors",
    "/api/v1/sponsors/display",
    "/api/v1/sponsors/tiers",
    "/api/v1/events",
    "/api/v1/events/pqc-2026/terms",
    "/api/v1/votes/feed.rss",
    "/api/v1/groups/group-1/directory",
    "/news?category=articles",
    "/news/feed/index.xml",
    "/members/example-org",
  ])("sends anonymous public GET and HEAD requests for %s to the cached entrypoint", (path) => {
    for (const method of ["GET", "HEAD"]) {
      expect(isPublicReadCacheCandidate(new Request(`https://pkic.org${path}`, { method }))).toBe(true);
    }
  });

  it.each([
    ["/api/v1/members?view=staff", {}],
    ["/api/v1/members/capacities", {}],
    ["/api/v1/sponsors/123", {}],
    ["/api/v1/events/pqc-2026/registrations", {}],
    ["/members/profile", {}],
    ["/members/independent", {}],
    ["/api/v1/members", { headers: { authorization: "Bearer token" } }],
    ["/api/v1/members", { headers: { "x-user-token": "token" } }],
    ["/api/v1/members", { headers: { cookie: "pkic_session=token" } }],
    ["/api/v1/members", { method: "POST" }],
  ])("keeps %s with request options %j outside the shared cache", (path, options) => {
    expect(isPublicReadCacheCandidate(new Request(`https://pkic.org${path}`, options))).toBe(false);
  });

  it("only permits successful, explicitly public responses into the cache", () => {
    for (const response of [
      new Response("failure", { status: 500, headers: { "cache-control": "public, max-age=300" } }),
      new Response("private", { headers: { "cache-control": "private, max-age=300" } }),
      new Response("cookie", { headers: { "cache-control": "public, max-age=300", "set-cookie": "x=y" } }),
    ]) {
      expect(publicReadCacheResponse(response).headers.get("cache-control")).toBe("no-store, max-age=0");
    }

    const result = publicReadCacheResponse(
      new Response("public", {
        headers: { "cache-control": "public, max-age=300, s-maxage=900", "x-request-id": "old-request" },
      }),
    );
    expect(result.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=900");
    expect(result.headers.has("x-request-id")).toBe(false);
  });
});
