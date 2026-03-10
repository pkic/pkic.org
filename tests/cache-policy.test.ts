import { describe, it, expect } from "vitest";
import { onRequest as apiMiddlewareOnRequest } from "../functions/api/v1/_middleware";
import { onRequest as redirectMiddlewareOnRequest } from "../functions/r/_middleware";
import { createEnv } from "./helpers/context";
import { D1DatabaseShim } from "./helpers/d1-shim";
import type { PagesContext } from "../functions/_lib/types";

function createMiddlewareContext(
  request: Request,
  nextResponse: Response,
): PagesContext {
  const db = new D1DatabaseShim();
  db.runMigrations();
  const env = createEnv(db);

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
        new Request("https://app.test/api/v1/admin/email-templates", {
          headers: { authorization: "Bearer x" },
        }),
        new Response("{}", { status: 200 }),
      ),
    );
    expect(adminResponse.headers.get("cache-control")).toContain("no-store");
  });

  it("adds no-store to referral/redirect routes", async () => {
    const referralResponse = await redirectMiddlewareOnRequest(
      createMiddlewareContext(
        new Request("https://app.test/r/abc1234"),
        new Response(null, { status: 302 }),
      ),
    );
    expect(referralResponse.headers.get("cache-control")).toContain("no-store");
  });

});
