import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  buildMcpOauthUiUrl,
  describeMcpAuthorization,
  type McpOAuthEnv,
} from "../functions/_lib/auth/oauth/authorization";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertIndividualMember } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import {
  createMcpAuthorizationContinuation,
  readMcpAuthorizationContinuation,
} from "../functions/_lib/auth/oauth/continuation";
import { createMcpAuthorizeHandler } from "../functions/_lib/auth/oauth/consent";
import { Hono } from "hono";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";

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
      redirectHost: "client.example",
      actingIdentityId: null,
      areas: [
        {
          key: "events",
          label: "Events",
          permissions: [{ permission: "events:read", access: "read", allResources: true, resourceCount: 0 }],
        },
      ],
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

  it("offers reauthentication when a representative's staff capacity has timed out", async () => {
    await seedEventAndAdmin(env.DB);
    const [staff] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
      "admin@pkic.org",
    ]);
    const organizationId = await insertOrganization(env.DB, "Example Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId);
    await addRepresentative(env.DB, memberId, staff.id);
    const token = await createAdminSession(env.DB, staff.id, crypto.randomUUID());
    await env.DB.prepare("UPDATE sessions SET created_at = ? WHERE user_id = ?")
      .bind(new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(), staff.id)
      .run();
    const context = await describeMcpAuthorization(
      new Request(`https://app.test${MCP_OAUTH_AUTHORIZE_PATH}`, { headers: { cookie: `pkic_session=${token}` } }),
      oauthEnv(),
      RETURN_TO,
    );
    expect(context).toMatchObject({
      authenticated: false,
      authorized: false,
      userEmail: null,
      staffEmail: null,
      grantedScopes: [],
    });
  });

  it("preserves a validated request through a short reference without granting a session", async () => {
    const testEnv = oauthEnv();
    const request = new Request(`https://app.test${RETURN_TO}`);
    const id = await createMcpAuthorizationContinuation(request, testEnv);
    const lookup = new Request(`https://app.test${MCP_OAUTH_AUTHORIZE_PATH}?request=${id}`);
    expect(await readMcpAuthorizationContinuation(lookup, testEnv)).toBe(RETURN_TO);
    expect((await describeMcpAuthorization(lookup, testEnv, RETURN_TO)).authenticated).toBe(false);
    await testEnv.OAUTH_KV!.delete(`mcp-authorization-request:${id}`);
    await expect(readMcpAuthorizationContinuation(lookup, testEnv)).rejects.toMatchObject({
      code: "OAUTH_REQUEST_EXPIRED",
    });
    await expect(
      readMcpAuthorizationContinuation(
        new Request(`https://app.test${MCP_OAUTH_AUTHORIZE_PATH}?request=invalid`),
        testEnv,
      ),
    ).rejects.toMatchObject({ code: "OAUTH_REQUEST_EXPIRED" });
  });

  it("limits anonymous continuation creation before writing to KV", async () => {
    const testEnv = oauthEnv();
    const write = vi.spyOn(testEnv.OAUTH_KV, "put");
    try {
      await expect(
        createMcpAuthorizationContinuation(new Request(`https://app.test${RETURN_TO}`), {
          ...testEnv,
          IP_RATE_LIMITER: { limit: async () => ({ success: false }) },
        }),
      ).rejects.toMatchObject({ status: 429 });
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it("builds only the portal UI link and keeps authorization state in the fragment", () => {
    const url = new URL(
      buildMcpOauthUiUrl(
        { APP_BASE_URL: "https://app.test" },
        new Request("https://app.test"),
        "00000000-0000-4000-8000-000000000001",
      ),
    );
    expect(url.pathname).toBe("/portal/");
    expect(url.search).toBe("");
    expect(url.hash).toContain("#/auth/oauth?");
    expect(new URLSearchParams(url.hash.split("?", 2)[1]).get("request")).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("removes the parallel MCP email sign-in action", async () => {
    const handler = createMcpAuthorizeHandler({ app: new Hono() });
    const response = await handler.fetch(
      new Request(`https://app.test${MCP_OAUTH_AUTHORIZE_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request-link", email: "admin@pkic.org", return_to: RETURN_TO }),
      }),
      oauthEnv(),
      { waitUntil() {} } as unknown as ExecutionContext,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });
});
