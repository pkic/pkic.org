import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { parseCapabilityToken } from "../functions/_lib/auth/capability-token";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  buildMcpOauthUiUrl,
  describeMcpAuthorization,
  sendMcpAuthorizeMagicLink,
  type McpOAuthEnv,
} from "../functions/_lib/mcp/oauth";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertIndividualMember } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { createMcpAuthorizeHandler } from "../functions/_lib/mcp/authorize";
import { Hono } from "hono";

const RETURN_TO = `${MCP_OAUTH_AUTHORIZE_PATH}?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&scope=events%3Aread&state=state-1`;

function oauthEnv(): McpOAuthEnv {
  const provider = {
    parseAuthRequest: async () => ({
      clientId: "client-1",
      redirectUri: "https://client.example/callback",
      scope: ["events:read"],
      state: "state-1",
    }),
    lookupClient: async () => ({ clientId: "client-1", clientName: "Test client" }),
  } as unknown as OAuthHelpers;
  return { ...(env as unknown as McpOAuthEnv), OAUTH_PROVIDER: provider };
}

describe("MCP authorization through canonical portal authentication", () => {
  beforeEach(resetDb);

  it("derives authorization from the canonical user session rather than a second login cookie", async () => {
    await seedEventAndAdmin(env.DB);
    const [staff] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
      "admin@pkic.org",
    ]);
    const testEnv = oauthEnv();
    const anonymous = await describeMcpAuthorization(
      new Request(`https://app.test${MCP_OAUTH_AUTHORIZE_PATH}`),
      testEnv,
      RETURN_TO,
    );
    expect(anonymous).toMatchObject({
      authenticated: false,
      authorized: false,
      userEmail: null,
      staffEmail: null,
    });

    const token = await createAdminSession(env.DB, staff.id, crypto.randomUUID());
    const authenticated = await describeMcpAuthorization(
      new Request(`https://app.test${MCP_OAUTH_AUTHORIZE_PATH}`, {
        headers: { cookie: `pkic_session=${token}` },
      }),
      testEnv,
      RETURN_TO,
    );
    expect(authenticated).toMatchObject({
      authenticated: true,
      authorized: true,
      clientId: "client-1",
      clientName: "Test client",
      userEmail: "admin@pkic.org",
      staffEmail: "admin@pkic.org",
      requestedScopes: ["events:read"],
      grantedScopes: ["events:read"],
    });
  });

  it("distinguishes an authenticated member from a staff identity that may authorize the client", async () => {
    const member = await insertIndividualMember(env.DB, "H6", "member@example.test");
    const token = await createMemberSession(env.DB, member.userId, crypto.randomUUID());
    const context = await describeMcpAuthorization(
      new Request(`https://app.test${MCP_OAUTH_AUTHORIZE_PATH}`, {
        headers: { cookie: `pkic_session=${token}` },
      }),
      oauthEnv(),
      RETURN_TO,
    );

    expect(context).toMatchObject({
      authenticated: true,
      authorized: false,
      userEmail: "member@example.test",
      staffEmail: null,
      grantedScopes: [],
    });
  });

  it("queues the canonical user sign-in capability back to the portal authorization screen", async () => {
    await seedEventAndAdmin(env.DB);
    const testEnv = oauthEnv();
    const background: Promise<unknown>[] = [];
    await sendMcpAuthorizeMagicLink({
      request: new Request(`https://app.test${MCP_OAUTH_AUTHORIZE_PATH}`, {
        headers: { "cf-connecting-ip": "203.0.113.10", "user-agent": "oauth-test" },
      }),
      env: testEnv,
      executionCtx: {
        waitUntil: (promise: Promise<unknown>) => {
          background.push(Promise.resolve(promise));
        },
      } as unknown as ExecutionContext,
      email: "admin@pkic.org",
      returnTo: RETURN_TO,
    });

    const [outbox] = await queryAll<{ template_key: string; payload_json: string }>(
      env.DB,
      "SELECT template_key, payload_json FROM email_outbox ORDER BY rowid DESC LIMIT 1",
    );
    expect(outbox.template_key).toBe("user_magic_link");
    const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
    const url = new URL(delivered.magicLinkUrl);
    const params = new URLSearchParams(url.hash.split("?", 2)[1]);
    expect(`${url.pathname}${url.hash.split("?", 1)[0]}`).toBe("/portal/#/auth/oauth");
    expect(params.get("return_to")).toBe(RETURN_TO);
    expect(parseCapabilityToken(params.get("token") ?? "", "user_sign_in")).not.toBeNull();
    expect(background).toHaveLength(1);
  });

  it("builds only the portal UI link and keeps authorization state in the fragment", () => {
    const url = new URL(
      buildMcpOauthUiUrl({ APP_BASE_URL: "https://app.test" }, new Request("https://app.test"), RETURN_TO),
    );
    expect(url.pathname).toBe("/portal/");
    expect(url.search).toBe("");
    expect(url.hash).toContain("#/auth/oauth?");
    expect(new URLSearchParams(url.hash.split("?", 2)[1]).get("return_to")).toBe(RETURN_TO);
  });

  it("rejects an invalid sign-in address before queueing email", async () => {
    const handler = createMcpAuthorizeHandler({ app: new Hono() });
    const response = await handler.fetch(
      new Request(`https://app.test${MCP_OAUTH_AUTHORIZE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request-link", email: "not-an-email", return_to: RETURN_TO }),
      }),
      oauthEnv(),
      { waitUntil() {} } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });
});
