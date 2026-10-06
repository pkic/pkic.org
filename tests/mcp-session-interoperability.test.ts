import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app from "../functions/router";
import { Hono } from "hono";
import { createMcpWorkerFetch, MCP_PATH } from "../functions/_lib/api-tools/mcp-worker";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  MCP_OAUTH_REGISTER_PATH,
  MCP_OAUTH_TOKEN_PATH,
} from "../functions/_lib/auth/oauth/authorization";
import type { Env } from "../functions/_lib/types";
import { resolveMcpExternalToken } from "../functions/_lib/auth/oauth/authorization";
import { requireActiveMcpSession } from "../functions/_lib/auth/oauth/session-authorization";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

const origin = "https://app.test";
const redirectUri = "http://127.0.0.1:1455/callback";
const verifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const fetchMcp = createMcpWorkerFetch({
  app: new Hono<{ Bindings: Env }>(),
  getMcpOpenApiSchema: async () => ({ openapi: "3.1.0", info: { title: "Test API", version: "v1" }, paths: {} }),
});

async function call(path: string, init?: RequestInit): Promise<Response> {
  const context = createExecutionContext();
  const response = await fetchMcp(new Request(`${origin}${path}`, init), env, context);
  await waitOnExecutionContext(context);
  return response;
}

async function authorize() {
  const [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
    "admin@pkic.org",
  ]);
  const session = await createAdminSession(env.DB, user.id, crypto.randomUUID());
  const registration = await call(MCP_OAUTH_REGISTER_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "MCP interoperability test",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = (await registration.json()) as { client_id: string };
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const returnTo = `${MCP_OAUTH_AUTHORIZE_PATH}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "forms:read organizations:read users:read", state: "test-state", code_challenge: challenge, code_challenge_method: "S256", resource: `${origin}${MCP_PATH}` })}`;
  const approval = await call(MCP_OAUTH_AUTHORIZE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pkic_session=${session}` },
    body: JSON.stringify({ action: "approve", return_to: returnTo }),
  });
  expect(approval.status).toBe(200);
  const { redirectTo } = (await approval.json()) as { redirectTo: string };
  const callback = new URL(redirectTo);
  expect(callback.searchParams.get("state")).toBe("test-state");
  const tokens = await exchange({
    grant_type: "authorization_code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code: callback.searchParams.get("code")!,
    code_verifier: verifier,
    resource: `${origin}${MCP_PATH}`,
  });
  expect(tokens.status).toBe(200);
  return {
    clientId,
    userToken: session,
    userId: user.id,
    ...((await tokens.json()) as { access_token: string; refresh_token: string; expires_in: number }),
  };
}

function exchange(body: Record<string, string>) {
  return call(MCP_OAUTH_TOKEN_PATH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

function initialize(token: string) {
  return call(MCP_PATH, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-client", version: "1" } },
    }),
  });
}

describe("MCP OAuth session interoperability", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
  });

  it("discovers the canonical resource and completes public-client PKCE login and refresh", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", `/.well-known/oauth-protected-resource${MCP_PATH}`]) {
      const response = await call(path);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        resource: `${origin}${MCP_PATH}`,
        authorization_servers: [origin],
      });
    }
    const grant = await authorize();
    expect((await initialize(grant.access_token)).status).toBe(200);
    const refreshed = await exchange({
      grant_type: "refresh_token",
      client_id: grant.clientId,
      refresh_token: grant.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const tokens = (await refreshed.json()) as { access_token: string };
    expect((await initialize(tokens.access_token)).status).toBe(200);
  });

  it.each(["expired", "revoked", "deactivated"])(
    "challenges a %s session, rejects refresh, and allows a new login",
    async (reason) => {
      const grant = await authorize();
      if (reason === "deactivated") {
        await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(grant.userId).run();
      } else if (reason === "expired") {
        await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?")
          .bind(new Date(Date.now() - 1000).toISOString(), grant.userId)
          .run();
      } else {
        await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ?")
          .bind(new Date().toISOString(), grant.userId)
          .run();
      }
      const response = await initialize(grant.access_token);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        `resource_metadata="${origin}/.well-known/oauth-protected-resource${MCP_PATH}"`,
      );
      expect(await response.json()).toMatchObject({ error: "invalid_token" });
      const refreshed = await exchange({
        grant_type: "refresh_token",
        client_id: grant.clientId,
        refresh_token: grant.refresh_token,
      });
      expect(refreshed.status).toBe(400);
      expect(await refreshed.json()).toMatchObject({ error: "invalid_grant" });
      if (reason === "deactivated")
        await env.DB.prepare("UPDATE users SET active = 1 WHERE id = ?").bind(grant.userId).run();
      const nextGrant = await authorize();
      expect((await initialize(nextGrant.access_token)).status).toBe(200);
    },
  );

  it.each(["request", "refresh"])(
    "expires an idle staff grant through %s and requires a new session",
    async (firstPath) => {
      const grant = await authorize();
      expect(grant.expires_in).toBeLessThanOrEqual(60 * 60);
      const [session] = await queryAll<{ id: string; expires_at: string; revoked_at: string | null }>(
        env.DB,
        "SELECT id, expires_at, revoked_at FROM sessions WHERE user_id = ?",
        [grant.userId],
      );
      expect(session.revoked_at).toBeNull();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 61 * 60 * 1000);
      expect(Date.parse(session.expires_at)).toBeGreaterThan(Date.now());

      if (firstPath === "request") {
        const expired = await initialize(grant.access_token);
        expect(expired.status).toBe(401);
        expect(expired.headers.get("www-authenticate")).toContain("resource_metadata=");
      }
      const refresh = await exchange({
        grant_type: "refresh_token",
        client_id: grant.clientId,
        refresh_token: grant.refresh_token,
      });
      expect(refresh.status).toBe(400);
      expect(await refresh.json()).toMatchObject({ error: "invalid_grant" });
      const [revoked] = await queryAll<{ revoked_at: string }>(env.DB, "SELECT revoked_at FROM sessions WHERE id = ?", [
        session.id,
      ]);
      expect(revoked.revoked_at).toBe(new Date().toISOString());
      const context = createExecutionContext();
      const portal = await app.fetch(
        new Request(`${origin}/api/v1/auth/session`, { headers: { cookie: `pkic_session=${grant.userToken}` } }),
        env,
        context,
      );
      await waitOnExecutionContext(context);
      expect(portal.status).toBe(401);
      expect(await portal.json()).toMatchObject({ error: { code: "AUTH_REVOKED" } });
      expect((await initialize(grant.access_token)).status).toBe(401);

      const newGrant = await authorize();
      expect((await initialize(newGrant.access_token)).status).toBe(200);
    },
  );

  it("keeps API-key service access independent of human inactivity deadlines", async () => {
    const grant = await resolveMcpExternalToken({
      token: env.ADMIN_API_KEY!,
      request: new Request(`${origin}${MCP_PATH}`),
      env,
    });
    expect(grant?.props.identityType).toBe("service");
    expect(await requireActiveMcpSession(env, grant!.props)).toBeNull();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    expect(await requireActiveMcpSession(env, grant!.props)).toBeNull();
  });

  it("caps refreshed access tokens at the live session deadline", async () => {
    const grant = await authorize();
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?")
      .bind(new Date(Date.now() + 120_000).toISOString(), grant.userId)
      .run();
    const refreshed = await exchange({
      grant_type: "refresh_token",
      client_id: grant.clientId,
      refresh_token: grant.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const tokens = (await refreshed.json()) as { expires_in: number };
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.expires_in).toBeLessThanOrEqual(120);
  });
});
