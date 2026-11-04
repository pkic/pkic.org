import { expect } from "vitest";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { Env } from "../../functions/_lib/types";
import app from "./app";
import { createAdminSession } from "./auth";
import type { AuthScope } from "../../functions/_lib/auth/scopes";
import { queryAll } from "./context";
import { MCP_PATH } from "../../functions/_lib/api-tools/mcp-worker";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  MCP_OAUTH_REGISTER_PATH,
  MCP_OAUTH_TOKEN_PATH,
} from "../../functions/_lib/auth/oauth/authorization";

export const MCP_TEST_ORIGIN = "https://app.test";
const origin = MCP_TEST_ORIGIN;
const redirectUri = "http://127.0.0.1:1455/callback";
export const MCP_TEST_VERIFIER = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const verifier = MCP_TEST_VERIFIER;
export function createMcpOauthTestClient(env: Env) {
  async function call(path: string, init?: RequestInit): Promise<Response> {
    const context = createExecutionContext();
    const response = await app.fetch(new Request(`${origin}${path}`, init), env, context);
    await waitOnExecutionContext(context);
    return response;
  }

  async function createAuthorization(
    userToken?: string,
    client?: { clientId: string; redirectUri: string },
    selectedScopes?: readonly AuthScope[],
    actingIdentityId: string | null = null,
  ) {
    const [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
      "admin@pkic.org",
    ]);
    const session =
      userToken ?? (await createAdminSession(env.DB, user.id, crypto.randomUUID(), env.INTERNAL_SIGNING_SECRET));
    let clientId = client?.clientId;
    const callbackUri = client?.redirectUri ?? redirectUri;
    if (!clientId) {
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
      clientId = ((await registration.json()) as { client_id: string }).client_id;
    }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const returnTo = `${MCP_OAUTH_AUTHORIZE_PATH}?${new URLSearchParams({ client_id: clientId, redirect_uri: callbackUri, response_type: "code", scope: selectedScopes?.join(" ") ?? "forms:read forms:write organizations:read users:read", state: "test-state", code_challenge: challenge, code_challenge_method: "S256", resource: `${origin}${MCP_PATH}` })}`;
    const approval = await call(MCP_OAUTH_AUTHORIZE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `pkic_session=${session}` },
      body: JSON.stringify({
        action: "approve",
        return_to: returnTo,
        scopes: selectedScopes ?? ["forms:read", "organizations:read", "users:read"],
        actingIdentityId,
      }),
    });
    expect(approval.status, await approval.clone().text()).toBe(202);
    const { authorizationId } = (await approval.json()) as { authorizationId: string };
    const completed = await call(`/api/v1/auth/oauth/authorizations/${authorizationId}/completion`, {
      headers: { cookie: `pkic_session=${session}` },
    });
    expect(completed.status).toBe(200);
    const { redirectTo, status } = (await completed.json()) as { redirectTo: string; status: string };
    expect(status).toBe("active");
    const callback = new URL(redirectTo);
    expect(callback.searchParams.get("state")).toBe("test-state");
    expect(callback.searchParams.get("iss")).toBe(origin);
    return {
      authorizationId,
      clientId,
      redirectUri: callbackUri,
      userToken: session,
      userId: user.id,
      code: callback.searchParams.get("code")!,
    };
  }

  function redeemCode(grant: Awaited<ReturnType<typeof createAuthorization>>) {
    return exchange({
      grant_type: "authorization_code",
      client_id: grant.clientId,
      redirect_uri: grant.redirectUri,
      code: grant.code,
      code_verifier: verifier,
      resource: `${origin}${MCP_PATH}`,
    });
  }

  async function authorize(
    userToken?: string,
    selectedScopes?: readonly AuthScope[],
    actingIdentityId: string | null = null,
  ) {
    const grant = await createAuthorization(userToken, undefined, selectedScopes, actingIdentityId);
    const tokens = await redeemCode(grant);
    expect(tokens.status).toBe(200);
    return {
      ...grant,
      ...((await tokens.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string }),
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

  async function callTool(token: string, name: string, args: Record<string, unknown>) {
    const response = await call(MCP_PATH, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    const payload = text.startsWith("event:")
      ? text
          .split("\n")
          .find((line) => line.startsWith("data: "))!
          .slice(6)
      : text;
    const rpc = JSON.parse(payload);
    expect(rpc.error).toBeUndefined();
    return rpc.result;
  }

  return { call, callTool, createAuthorization, redeemCode, authorize, exchange, initialize };
}
