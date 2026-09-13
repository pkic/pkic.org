import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createMcpSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { createTestRateLimiter, queryAll, seedEventAndAdmin } from "./helpers/context";
import type { Env } from "../functions/_lib/types";

let environment: Env;
const path = "/api/v1/members/join/start";
const body = { email: "new@company.example", unaffiliatedAttestation: true };
function post(headers: Record<string, string> = {}, payload: unknown = body, endpoint = path) {
  return callApi(environment, endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
}
beforeEach(async () => {
  await resetDb();
  environment = {
    ...env,
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SITE_KEY: "test-site-key",
    TURNSTILE_SECRET: "test-secret",
    TURNSTILE_HOSTNAMES: "app.test",
    APP_BASE_URL: "https://app.test",
    IP_RATE_LIMITER: createTestRateLimiter(100),
    EMAIL_RATE_LIMITER: createTestRateLimiter(100),
  };
});
afterEach(() => vi.restoreAllMocks());
function verify(result: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(result, { status }));
}
async function noEffects() {
  expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
}

describe("public route Turnstile policy", () => {
  it("advertises the action without executing the handler or exposing the secret", async () => {
    const response = await post();
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({
      error: { code: "TURNSTILE_REQUIRED", details: { siteKey: "test-site-key", action: "membership_join" } },
    });
    await noEffects();
  });
  it("validates the contract before advertising a challenge", async () => {
    expect((await post({}, { email: "invalid" })).status).toBe(400);
    await noEffects();
  });
  it.each([undefined, "false"])("can be disabled (%s)", async (enabled) => {
    environment.TURNSTILE_ENABLED = enabled;
    expect((await post()).status).toBe(200);
  });
  it.each(["TURNSTILE_SECRET", "TURNSTILE_SITE_KEY", "TURNSTILE_HOSTNAMES"] as const)(
    "fails closed when enabled without %s",
    async (key) => {
      environment[key] = "";
      expect((await post()).status).toBe(503);
      await noEffects();
    },
  );
  it("rejects a misspelled switch and local host allowlisting on a public deployment", async () => {
    environment.TURNSTILE_ENABLED = "tru";
    expect((await post()).status).toBe(503);
    environment.TURNSTILE_ENABLED = "true";
    environment.TURNSTILE_HOSTNAMES = "app.test,localhost";
    expect((await post()).status).toBe(503);
  });
  it("verifies a token before queuing exactly one email", async () => {
    const remote = verify({ success: true, action: "membership_join", hostname: "app.test" });
    expect((await post({ "x-turnstile-token": "fresh-token" })).status).toBe(200);
    expect(remote).toHaveBeenCalledOnce();
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(1);
    const submitted = remote.mock.calls[0][1]?.body as URLSearchParams;
    expect(submitted.get("response")).toBe("fresh-token");
    expect(submitted.get("secret")).toBe("test-secret");
  });
  it.each([
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    { success: true, action: "login_email", hostname: "app.test" },
    { success: true, action: "membership_join", hostname: "evil.example" },
  ])("rejects failed, replayed and incorrectly bound tokens: %j", async (result) => {
    verify(result);
    expect((await post({ "x-turnstile-token": "bad-token" })).status).toBe(403);
    await noEffects();
  });
  it("fails closed during verification outages", async () => {
    verify({}, 503);
    expect((await post({ "x-turnstile-token": "token" })).status).toBe(503);
    await noEffects();
  });
  it("rejects oversized tokens without contacting Cloudflare", async () => {
    const remote = verify({});
    expect((await post({ "x-turnstile-token": "x".repeat(2049) })).status).toBe(403);
    expect(remote).not.toHaveBeenCalled();
  });
  it("accepts a verified service API credential and preserves the business workflow", async () => {
    environment.ADMIN_API_KEY = "service-secret";
    expect((await post({ authorization: "Bearer service-secret" })).status).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(1);
  });
  it("does not bypass for invalid credentials or spoofed client headers", async () => {
    expect((await post({ authorization: "Bearer fake", "x-pkic-machine-auth": "mcp" })).status).toBe(401);
    expect((await post({ "user-agent": "API client", "x-pkic-machine-auth": "mcp" })).status).toBe(403);
    await noEffects();
  });
  it("requires the declared OAuth scope and rechecks session revocation", async () => {
    await seedEventAndAdmin(env.DB);
    const [actor] = await queryAll<{ id: string; email: string; role: string }>(
      env.DB,
      "SELECT id, email, role FROM users WHERE normalized_email = 'admin@pkic.org'",
    );
    const limited = await createMcpSession(env.DB, actor, "limited", ["membership:read"]);
    expect((await post({ authorization: `Bearer ${limited}`, "x-pkic-machine-auth": "mcp" })).status).toBe(403);
    const allowed = await createMcpSession(env.DB, actor, "allowed", ["membership:write"]);
    expect((await post({ authorization: `Bearer ${allowed}`, "x-pkic-machine-auth": "mcp" })).status).toBe(200);
    await env.DB.prepare("UPDATE sessions SET revoked_at = '2026-01-01T00:00:00.000Z' WHERE user_id = ?")
      .bind(actor.id)
      .run();
    expect((await post({ authorization: `Bearer ${allowed}`, "x-pkic-machine-auth": "mcp" })).status).toBe(401);
  });
  it("leaves email link verification challenge-free", async () => {
    const response = await post({}, { token: "x".repeat(64) }, "/api/v1/members/join/verify");
    expect(await response.json()).not.toMatchObject({ error: { code: "TURNSTILE_REQUIRED" } });
  });
});
