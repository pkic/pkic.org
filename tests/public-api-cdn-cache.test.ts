import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { isAnonymousReadRequest, markPublicRead, publicReadCacheResponse } from "../functions/_lib/cache/public-read";
import worker from "./helpers/app";

describe("public API CDN cache gateway", () => {
  it("marks only anonymous, nonsensitive successful route responses public", () => {
    const url = "https://pkic.org/api/v1/members";
    expect(markPublicRead(new Request(url), new Response("public")).headers.get("cache-control")).toBe("public");
    for (const request of [
      new Request(url, { headers: { authorization: "Bearer staff" } }),
      new Request(url, { headers: { cookie: "pkic_session=staff" } }),
    ]) {
      expect(markPublicRead(request, new Response("staff")).headers.has("cache-control")).toBe(false);
    }
    expect(markPublicRead(new Request(url), new Response("sensitive"), true).headers.has("cache-control")).toBe(false);
    expect(
      markPublicRead(
        new Request(url),
        new Response("private", { headers: { "cache-control": "private" } }),
      ).headers.get("cache-control"),
    ).toBe("private");
  });

  it("returns the cached entrypoint response without running the API handler", async () => {
    let calls = 0;
    let cacheKey = "";
    const ctx = {
      exports: {
        PublicRead: {
          async fetch(_request: Request, init: { cf: { cacheKey: string } }) {
            calls++;
            cacheKey = init.cf.cacheKey;
            return new Response("cached", { headers: { "cf-cache-status": "HIT" } });
          },
        },
      },
    } as unknown as ExecutionContext;

    const response = await worker.fetch(new Request("https://pkic.org/api/v1/members"), env, ctx);
    expect(await response.text()).toBe("cached");
    expect(response.headers.get("cf-cache-status")).toBe("HIT");
    expect(calls).toBe(1);
    expect(cacheKey).toBe("https://pkic.org/api/v1/members");
  });

  it.each(["GET", "HEAD"])("forwards an incoming %s with an empty body to the cache", async (method) => {
    const url = "https://app.test/r/synthetic-referral?source=test";
    // workerd accepts body-bearing reads from HTTP, but its Request constructor refuses them.
    // Preserve a native empty body and expose the incoming read method to the gateway.
    const request = new Request(url, {
      method: "POST",
      body: "",
      headers: { "content-length": "0", "user-agent": "synthetic-preview" },
      cf: { country: "NL" },
    });
    Object.defineProperty(request, "method", { value: method });
    expect(request.body).not.toBeNull();

    let forwarded = false;
    const ctx = createExecutionContext();
    Object.defineProperty(ctx, "exports", {
      value: {
        PublicRead: {
          async fetch(cacheRequest: Request, init: { cf: { cacheKey: string } }) {
            forwarded = true;
            expect(cacheRequest.method).toBe("GET");
            expect(cacheRequest.body).toBeNull();
            expect(cacheRequest.url).toBe(url);
            expect(cacheRequest.cf?.country).toBe("NL");
            expect(cacheRequest.headers.get("user-agent")).toBe("synthetic-preview");
            expect(init.cf.cacheKey).toBe(url);
            return new Response("referral page");
          },
        },
      },
    });

    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    expect(forwarded).toBe(true);
    expect(await response.text()).toBe(method === "HEAD" ? "" : "referral page");
  });

  it.each(["GET", "HEAD"])("handles anonymous authentication %s directly without a cache hop", async (method) => {
    const ctx = {
      exports: {
        PublicRead: {
          async fetch() {
            throw new Error("Authentication must not enter the shared cache");
          },
        },
      },
    } as unknown as ExecutionContext;
    const response = await worker.fetch(new Request("https://pkic.org/api/v1/auth/session", { method }), env, ctx);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it.each(["GET", "HEAD"])("keeps the visitor country on the original anonymous %s request", async (method) => {
    const ctx = createExecutionContext();
    let cacheCalls = 0;
    Object.defineProperty(ctx, "exports", {
      value: {
        PublicRead: {
          async fetch() {
            cacheCalls++;
            return new Response(JSON.stringify({ country: null }));
          },
        },
      },
    });
    for (const country of ["NL", "CA", null]) {
      const response = await worker.fetch(
        new Request("https://app.test/api/v1/geolocation/country", {
          method,
          headers: { "sec-fetch-site": "same-origin" },
          cf: { country },
        }),
        env,
        ctx,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("private");
      expect(await response.text()).toBe(method === "HEAD" ? "" : JSON.stringify({ country }));
    }
    expect(cacheCalls).toBe(0);
  });

  it("answers browser validators from the cached representation", async () => {
    let forwardedMethod = "";
    let forwardedValidator: string | null = null;
    const ctx = {
      exports: {
        PublicRead: {
          async fetch(request: Request) {
            forwardedMethod = request.method;
            forwardedValidator = request.headers.get("if-none-match");
            return new Response("cached", {
              headers: { etag: '"cached-etag"', "cache-control": "public, max-age=3600" },
            });
          },
        },
      },
    } as unknown as ExecutionContext;
    const request = new Request("https://pkic.org/api/v1/members", {
      method: "HEAD",
      headers: { "if-none-match": '"cached-etag"' },
    });
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(304);
    expect(forwardedMethod).toBe("GET");
    expect(forwardedValidator).toBeNull();
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
    "/api/v1/members?view=staff",
    "/api/v1/members/capacities",
    "/members/profile",
  ])("routes anonymous GET and HEAD requests for %s through the public-policy entrypoint", (path) => {
    for (const method of ["GET", "HEAD"]) {
      expect(isAnonymousReadRequest(new Request(`https://pkic.org${path}`, { method }))).toBe(true);
    }
  });

  it.each([
    ["/api/v1/members", { headers: { authorization: "Bearer token" } }],
    ["/api/v1/members", { headers: { "x-user-token": "token" } }],
    ["/api/v1/members", { headers: { cookie: "pkic_session=token" } }],
    ["/api/v1/members", { method: "POST" }],
  ])("keeps %s with request options %j outside the shared cache", (path, options) => {
    expect(isAnonymousReadRequest(new Request(`https://pkic.org${path}`, options))).toBe(false);
  });

  it("only permits successful, explicitly public responses into the cache", async () => {
    for (const response of [
      new Response("failure", { status: 500, headers: { "cache-control": "public, max-age=300" } }),
      new Response("partial", { status: 206, headers: { "cache-control": "public" } }),
      new Response("private", { headers: { "cache-control": "private, max-age=300" } }),
      new Response("conflict", { headers: { "cache-control": "public, no-store" } }),
      new Response("cookie", { headers: { "cache-control": "public, max-age=300", "set-cookie": "x=y" } }),
      new Response("cdn", {
        headers: {
          "cache-control": "private, max-age=300",
          "cdn-cache-control": "public, max-age=900",
          "cloudflare-cdn-cache-control": "public, max-age=900",
        },
      }),
    ]) {
      const result = await publicReadCacheResponse(response, env);
      expect(result.headers.get("cache-control"), `${response.status}: ${response.headers.get("cache-control")}`).toBe(
        "no-store, max-age=0",
      );
      expect(result.headers.has("cdn-cache-control")).toBe(false);
      expect(result.headers.has("cloudflare-cdn-cache-control")).toBe(false);
    }

    const result = await publicReadCacheResponse(
      new Response("public", {
        headers: { "cache-control": "public", "content-type": "application/json", "x-request-id": "old-request" },
      }),
      { ...env, PUBLIC_READ_BROWSER_TTL_SECONDS: "7200", PUBLIC_READ_CDN_TTL_SECONDS: "172800" },
    );
    expect(result.headers.get("cache-control")).toBe("public, max-age=7200");
    expect(result.headers.get("cloudflare-cdn-cache-control")).toBe("public, max-age=172800");
    expect(result.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
    expect(result.headers.has("x-request-id")).toBe(false);
  });
});
