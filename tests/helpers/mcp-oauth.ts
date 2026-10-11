import { fromHono } from "chanfana";
import { expect } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { createMcpWorkerFetch, MCP_PATH } from "../../functions/_lib/api-tools/mcp-worker";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  MCP_OAUTH_REGISTER_PATH,
  MCP_OAUTH_TOKEN_PATH,
  type McpOAuthEnv,
} from "../../functions/_lib/auth/oauth/authorization";
import type { Env } from "../../functions/_lib/types";
import { createAdminSession } from "./auth";
import { queryAll } from "./context";
import authRouter from "../../functions/api/v1/auth/router";
import formsRouter from "../../functions/api/v1/forms/router";
import { handleError } from "../../functions/_lib/http";

const app = new Hono<{ Bindings: Env }>();
app.onError((error) => handleError(error));
const openapi = fromHono(app);
openapi.route("/api/v1/auth", authRouter);
openapi.route("/api/v1/forms", formsRouter);
// Test-only observation of the real provider's encrypted token properties.
app.get("/inspect-token", async (c) =>
  c.json(await (c.env as McpOAuthEnv).OAUTH_PROVIDER.unwrapToken(c.req.query("token")!)),
);
export const origin = "https://app.test";
const redirectUri = "http://127.0.0.1:1455/callback";
const verifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const fetchMcp = createMcpWorkerFetch({
  app,
  getMcpOpenApiSchema: async () => ({ openapi: "3.1.0", info: { title: "Test API", version: "v1" }, paths: {} }),
});

export async function call(path: string, init?: RequestInit, environment: Env = env): Promise<Response> {
  const context = createExecutionContext();
  const response = await fetchMcp(new Request(`${origin}${path}`, init), environment, context);
  await waitOnExecutionContext(context);
  return response;
}

export async function prepareAuthorization(
  requested = ["forms:read", "organizations:read", "users:read"],
  userToken?: string,
) {
  const [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
    "admin@pkic.org",
  ]);
  const session = userToken ?? (await createAdminSession(env.DB, user.id, crypto.randomUUID()));
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
  const returnTo = `${MCP_OAUTH_AUTHORIZE_PATH}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: requested.join(" "), state: "test-state", code_challenge: challenge, code_challenge_method: "S256", resource: `${origin}${MCP_PATH}` })}`;
  return { clientId, userId: user.id, cookie: `pkic_session=${session}`, returnTo };
}

export async function createAuthorization(
  scopes = ["forms:read", "organizations:read", "users:read"],
  requested = scopes,
  userToken?: string,
) {
  const { clientId, userId, cookie, returnTo } = await prepareAuthorization(requested, userToken);
  const approval = await call(MCP_OAUTH_AUTHORIZE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      action: "approve",
      return_to: returnTo,
      scopes,
    }),
  });
  expect(approval.status).toBe(200);
  const { redirectTo } = (await approval.json()) as { redirectTo: string };
  const callback = new URL(redirectTo);
  expect(callback.searchParams.get("state")).toBe("test-state");
  return { clientId, userId, cookie, returnTo, code: callback.searchParams.get("code")! };
}

export function redeemCode(grant: Awaited<ReturnType<typeof createAuthorization>>) {
  return exchange({
    grant_type: "authorization_code",
    client_id: grant.clientId,
    redirect_uri: redirectUri,
    code: grant.code,
    code_verifier: verifier,
    resource: `${origin}${MCP_PATH}`,
  });
}

export async function authorize(
  scopes = ["forms:read", "organizations:read", "users:read"],
  requested = scopes,
  userToken?: string,
) {
  const grant = await createAuthorization(scopes, requested, userToken);
  const tokens = await redeemCode(grant);
  expect(tokens.status).toBe(200);
  return {
    ...grant,
    ...((await tokens.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string }),
  };
}

export function exchange(body: Record<string, string>) {
  return call(MCP_OAUTH_TOKEN_PATH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
}

export function initialize(token: string) {
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
