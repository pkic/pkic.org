import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { call, authorize, exchange } from "./helpers/mcp-oauth";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { signMcpSessionToken } from "../functions/_lib/auth/mcp-session";
import { parseMcpOauthProps } from "../functions/_lib/auth/oauth/authorization";

async function inspect(token: string) {
  const response = await call(`/inspect-token?token=${encodeURIComponent(token)}`);
  const data = (await response.json()) as { grant: { props: unknown } };
  const props = parseMcpOauthProps(data.grant.props);
  if (!props || props.identityType !== "user") throw new Error("Expected user token");
  return props;
}
async function machineRequest(token: string, path = "/api/v1/forms", init?: RequestInit) {
  const props = await inspect(token);
  const internal = await signMcpSessionToken(env.INTERNAL_SIGNING_SECRET!, {
    sub: props.id,
    sid: props.sessionId,
    exp: Math.floor(new Date(props.sessionExpiresAt).getTime() / 1000),
    email: props.email,
    scopes: props.scopes,
  });
  return new Request(`https://app.test${path}`, {
    ...init,
    headers: { authorization: `Bearer ${internal}`, "x-pkic-machine-auth": "mcp", "content-type": "application/json" },
  });
}
async function api(token: string, init?: RequestInit) {
  const request = await machineRequest(token, "/api/v1/forms", init);
  return call(new URL(request.url).pathname, { method: request.method, headers: request.headers, body: init?.body });
}

describe("granular MCP consent", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
  });

  it("reports the approved read-only subset and denies unapproved writes through the mounted forms router", async () => {
    const grant = await authorize(["forms:read"], ["forms:read", "forms:write", "organizations:read", "users:write"]);
    expect(grant.scope).toBe("forms:read");
    expect((await api(grant.access_token)).status).toBe(200);
    const response = await api(grant.access_token, {
      method: "POST",
      body: JSON.stringify({ key: "example-form", title: "Example form", purpose: "survey", fields: [] }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "SCOPE_REQUIRED" } });
    const refreshed = await exchange({
      grant_type: "refresh_token",
      client_id: grant.clientId,
      refresh_token: grant.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toMatchObject({ scope: "forms:read" });
  });

  it.each([
    [[], 400],
    [["wildcard:*"], 400],
    [["forms:read", "forms:read"], 400],
    [["users:write"], 403],
    [undefined, 400],
  ])("rejects tampered or empty approval %j", async (scopes, status) => {
    const grant = await authorize(["forms:read"]);
    const response = await call("/api/v1/auth/oauth/authorize", {
      method: "POST",
      headers: { cookie: grant.cookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", return_to: grant.returnTo, scopes }),
    });
    expect(response.status).toBe(status);
  });

  it.each([null, [], 42])("rejects malformed JSON request bodies %j through the shared contract", async (body) => {
    const response = await call("/api/v1/auth/oauth/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("rechecks authority between display and approval", async () => {
    const grant = await authorize(["forms:read", "forms:write"]);
    await env.DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(grant.userId).run();
    await env.DB.prepare("INSERT INTO permission_grants (id, user_id, permission, created_at) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), grant.userId, "forms:read", new Date().toISOString())
      .run();
    const response = await call("/api/v1/auth/oauth/authorize", {
      method: "POST",
      headers: { cookie: grant.cookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", return_to: grant.returnTo, scopes: ["forms:write"] }),
    });
    expect(response.status).toBe(403);
  });

  it("narrows refreshed token scopes without expanding the original approval", async () => {
    const grant = await authorize(
      ["forms:read", "organizations:read"],
      ["forms:read", "forms:write", "organizations:read"],
    );
    const refreshed = await exchange({
      grant_type: "refresh_token",
      client_id: grant.clientId,
      refresh_token: grant.refresh_token,
      scope: "forms:read",
    });
    expect(refreshed.status).toBe(200);
    const tokens = (await refreshed.json()) as { access_token: string; refresh_token: string; scope: string };
    expect(tokens.scope).toBe("forms:read");
    expect((await inspect(tokens.access_token)).scopes).toEqual(["forms:read"]);
    const expansion = await exchange({
      grant_type: "refresh_token",
      client_id: grant.clientId,
      refresh_token: tokens.refresh_token,
      scope: "forms:write",
    });
    expect(expansion.status).toBe(400);
  });

  it("denies access through live permissions after the user's role is revoked", async () => {
    const grant = await authorize(["forms:read"]);
    await env.DB.prepare("DELETE FROM user_roles WHERE user_id = ?").bind(grant.userId).run();
    expect((await api(grant.access_token)).status).toBe(401);
  });

  it("returns denial to the client and rejects cross-origin consent", async () => {
    const grant = await authorize(["forms:read"]);
    const request = {
      method: "POST",
      headers: { cookie: grant.cookie, "content-type": "application/json" },
      body: JSON.stringify({ action: "deny", return_to: grant.returnTo }),
    };
    const denial = await call("/api/v1/auth/oauth/authorize", request);
    expect(denial.status).toBe(200);
    const redirect = (await denial.json()) as { redirectTo: string };
    expect(new URL(redirect.redirectTo).searchParams.get("error")).toBe("access_denied");
    expect(new URL(redirect.redirectTo).searchParams.get("state")).toBe("test-state");
    const crossOrigin = await call("/api/v1/auth/oauth/authorize", {
      ...request,
      headers: { ...request.headers, origin: "https://another.example.test" },
    });
    expect(crossOrigin.status).toBe(403);
  });
});
