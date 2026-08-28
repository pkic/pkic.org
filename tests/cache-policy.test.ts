import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { onRequest as apiMiddlewareOnRequest } from "../functions/api/v1/_middleware";
import { onRequest as donationRedirectMiddlewareOnRequest } from "../functions/donate/r/_middleware";
import { onRequest as redirectMiddlewareOnRequest } from "../functions/r/_middleware";
import type { PagesContext } from "../functions/_lib/types";

function createMiddlewareContext(request: Request, nextResponse: Response): PagesContext {
  return {
    request,
    env,
    params: {},
    waitUntil() {
      return;
    },
    next: async () => nextResponse,
  };
}

describe("cache policy middleware", () => {
  it("adds public cache headers to anonymous read endpoints", async () => {
    const response = await apiMiddlewareOnRequest(
      createMiddlewareContext(
        new Request("https://app.test/api/v1/events/pqc-2026/terms"),
        new Response("{}", { status: 200 }),
      ),
    );

    expect(response.headers.get("cache-control")).toContain("public");
  });

  it("adds no-store to authenticated and admin API endpoints", async () => {
    const adminResponse = await apiMiddlewareOnRequest(
      createMiddlewareContext(
        new Request("https://app.test/api/v1/system/email-templates", {
          headers: { authorization: "Bearer x" },
        }),
        new Response("{}", { status: 200 }),
      ),
    );
    expect(adminResponse.headers.get("cache-control")).toContain("no-store");
  });

  it.each(["/api/v1/analytics/summary", "/api/v1/email/outbox", "/api/v1/operations/due-work"])(
    "adds no-store to anonymous failures from the staff-only %s family",
    async (pathname) => {
      const response = await apiMiddlewareOnRequest(
        createMiddlewareContext(
          new Request(`https://app.test${pathname}`),
          new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 }),
        ),
      );

      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
      expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    },
  );

  it.each(["pkic_admin_session", "pkic_member_session", "pkic_sponsor_portal_session"])(
    "overrides cacheable responses when the %s cookie is present",
    async (cookieName) => {
      const response = await apiMiddlewareOnRequest(
        createMiddlewareContext(
          new Request("https://app.test/api/v1/events/pqc-2026/terms", {
            headers: { cookie: `${cookieName}=session-token` },
          }),
          new Response("{}", { status: 200, headers: { "cache-control": "public, max-age=300" } }),
        ),
      );

      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    },
  );

  it("does not disable public caching for unrelated cookies", async () => {
    const response = await apiMiddlewareOnRequest(
      createMiddlewareContext(
        new Request("https://app.test/api/v1/events/pqc-2026/terms", {
          headers: { cookie: "theme=dark" },
        }),
        new Response("{}", { status: 200 }),
      ),
    );

    expect(response.headers.get("cache-control")).toContain("public");
  });

  it.each([
    ["event referral", redirectMiddlewareOnRequest, "https://app.test/r/abc1234"],
    ["donation referral", donationRedirectMiddlewareOnRequest, "https://app.test/donate/r/abc1234"],
  ])("adds no-store to %s routes", async (_label, middleware, url) => {
    const response = await middleware(createMiddlewareContext(new Request(url), new Response(null, { status: 302 })));
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
