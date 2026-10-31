import { promotionKitSchema } from "../assets/shared/schemas/event-promotion-kit";
import { organizationsListResponseSchema } from "../assets/shared/schemas/organization-management";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import "../functions/http-router";
const env = { ...workerEnv, INTERNAL_SIGNING_SECRET: "synthetic-oauth-test-signing-secret-32-plus" };
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app, { callApi } from "./helpers/app";
import { MCP_PATH } from "../functions/_lib/api-tools/mcp-worker";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  MCP_OAUTH_REGISTER_PATH,
  MCP_OAUTH_TOKEN_PATH,
  resolveMcpExternalToken,
} from "../functions/_lib/auth/oauth/authorization";
import { resolveActiveMcpSession } from "../functions/_lib/auth/oauth/session-authorization";
import { AppError } from "../functions/_lib/errors";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";

const origin = "https://app.test";
const redirectUri = "http://127.0.0.1:1455/callback";
const verifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
async function call(path: string, init?: RequestInit): Promise<Response> {
  const context = createExecutionContext();
  const response = await app.fetch(new Request(`${origin}${path}`, init), env, context);
  await waitOnExecutionContext(context);
  return response;
}

async function createAuthorization(userToken?: string) {
  const [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
    "admin@pkic.org",
  ]);
  const session =
    userToken ?? (await createAdminSession(env.DB, user.id, crypto.randomUUID(), env.INTERNAL_SIGNING_SECRET));
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
  const returnTo = `${MCP_OAUTH_AUTHORIZE_PATH}?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "forms:read forms:write organizations:read users:read", state: "test-state", code_challenge: challenge, code_challenge_method: "S256", resource: `${origin}${MCP_PATH}` })}`;
  const approval = await call(MCP_OAUTH_AUTHORIZE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pkic_session=${session}` },
    body: JSON.stringify({
      action: "approve",
      return_to: returnTo,
      scopes: ["forms:read", "organizations:read", "users:read"],
      actingIdentityId: null,
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
  return { authorizationId, clientId, userToken: session, userId: user.id, code: callback.searchParams.get("code")! };
}

function redeemCode(grant: Awaited<ReturnType<typeof createAuthorization>>) {
  return exchange({
    grant_type: "authorization_code",
    client_id: grant.clientId,
    redirect_uri: redirectUri,
    code: grant.code,
    code_verifier: verifier,
    resource: `${origin}${MCP_PATH}`,
  });
}

async function authorize(userToken?: string) {
  const grant = await createAuthorization(userToken);
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

async function withAuthorizedMcpClient(
  run: (client: Client, grant: Awaited<ReturnType<typeof authorize>>) => Promise<void>,
) {
  const grant = await authorize();
  const client = new Client({ name: "scoped-operation-test", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_PATH, origin), {
    requestInit: { headers: { authorization: `Bearer ${grant.access_token}` } },
    fetch: (input, init) => callApi(env, new Request(input, init), undefined, { maxRoundTrips: 1 }),
  });
  try {
    await client.connect(transport);
    await run(client, grant);
  } finally {
    await client.close();
  }
}
function executeMcp(client: Client, code: string) {
  return client.callTool({ name: "execute", arguments: { code } });
}
async function registerPromotionAttendee(userId: string) {
  const event = await env.DB.prepare("SELECT id FROM events WHERE slug='pqc-2026'").first<{ id: string }>();
  const at = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','virtual','direct','synthetic',?,?)",
  )
    .bind(crypto.randomUUID(), event!.id, userId, at, at)
    .run();
}
async function prepareAttendeePromotion(grant: Awaited<ReturnType<typeof authorize>>) {
  await registerPromotionAttendee(grant.userId);
  const initialized = await callApi(
    env,
    "/api/v1/events/pqc-2026/promotion/referrals",
    {
      method: "POST",
      headers: { cookie: `pkic_session=${grant.userToken}`, "content-type": "application/json" },
      body: "{}",
    },
    { maxRoundTrips: 1 },
  );
  expect(initialized.status, await initialized.clone().text()).toBe(200);
  return promotionKitSchema.parse(await initialized.json());
}
function promotionSaveOperation(kit: ReturnType<typeof promotionKitSchema.parse>) {
  return {
    method: "POST",
    path: "/api/v1/events/pqc-2026/promotion/composition",
    body: {
      expectedRevision: kit.compositionRevision,
      composition: {
        ...kit.composition,
        summary: "An attendee invitation prepared through MCP.",
        takeaways: ["Compare practical cryptographic migration controls"],
      },
    },
  };
}

describe("MCP OAuth session interoperability", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

  it("discovers scoped operations through MCP search", async () => {
    await withAuthorizedMcpClient(async (client) => {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["search", "execute"]),
      );
      const search = await client.callTool({
        name: "search",
        arguments: {
          code: 'async () => { const spec = await codemode.spec(); return Object.keys(spec.paths).filter(path => path === "/api/v1/organizations"); }',
        },
      });
      expect(search.isError).not.toBe(true);
      expect(JSON.stringify(search.content)).toContain("/api/v1/organizations");
    });
  });
  it("executes a scoped organization listing in one authorized batch", async () => {
    await withAuthorizedMcpClient(async (client) => {
      const allowed = await executeMcp(
        client,
        'async () => codemode.request({ method: "GET", path: "/api/v1/organizations", query: { limit: 1 } })',
      );
      expect(allowed.isError, JSON.stringify(allowed)).not.toBe(true);
      const content = allowed.content as Array<{ type: string; text?: string }>;
      expect(content[0]?.type).toBe("text");
      expect(organizationsListResponseSchema.parse(JSON.parse(content[0]!.text!)).page.limit).toBe(1);
    });
  });
  it("enforces live removal of a delegated operation scope", async () => {
    await withAuthorizedMcpClient(async (client, grant) => {
      const code = 'async () => codemode.request({ method: "GET", path: "/api/v1/users" })';
      const allowed = await executeMcp(client, code);
      expect(allowed.isError, JSON.stringify(allowed)).not.toBe(true);
      await env.DB.prepare("DELETE FROM oauth_authorization_permissions WHERE authorization_id=? AND permission=?")
        .bind(grant.authorizationId, "users:read")
        .run();
      const narrowed = await executeMcp(client, code);
      expect(JSON.stringify(narrowed.content)).toMatch(/PERMISSION|SCOPE|FORBIDDEN/i);
    });
  });
  it.each([
    [
      "external origins",
      'async () => codemode.request({ method: "GET", path: "https://untrusted.example/api/v1/users" })',
      "exposed API operation",
    ],
    [
      "operation chains",
      'async () => { await codemode.request({ method: "GET", path: "/api/v1/users" }); return codemode.request({ method: "GET", path: "/api/v1/organizations" }); }',
      "exactly one",
    ],
  ])("refuses %s through the MCP protocol", async (_scenario, code, message) => {
    await withAuthorizedMcpClient(async (client) => {
      const refused = await executeMcp(client, code);
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toContain(message);
    });
  });
  it("initializes personal promotion materials through MCP", async () => {
    await withAuthorizedMcpClient(async (client, grant) => {
      await registerPromotionAttendee(grant.userId);
      const initialized = await executeMcp(
        client,
        'async () => codemode.request({method:"POST",path:"/api/v1/events/pqc-2026/promotion/referrals",body:{}})',
      );
      expect(initialized.isError, JSON.stringify(initialized)).not.toBe(true);
      const kit = promotionKitSchema.parse(JSON.parse((initialized.content as Array<{ text: string }>)[0]!.text));
      expect(kit.audience).toBe("attendee");
      expect(kit.registrationUrl).toMatch(/^https:\/\/app\.test\/r\//);
    });
  });
  it("saves and queues personal promotion materials through MCP", async () => {
    await withAuthorizedMcpClient(async (client, grant) => {
      const kit = await prepareAttendeePromotion(grant);
      const operation = promotionSaveOperation(kit);
      const saved = await executeMcp(client, `async () => codemode.request(${JSON.stringify(operation)})`);
      expect(saved.isError, JSON.stringify(saved)).not.toBe(true);
      const personal = promotionKitSchema.parse(JSON.parse((saved.content as Array<{ text: string }>)[0]!.text));
      expect(personal.compositionRevision).toBe(1);
      expect(personal.registrationUrl).toBe(kit.registrationUrl);
      expect(personal.composition?.takeaways).toEqual(operation.body.composition.takeaways);
      const queued = await executeMcp(
        client,
        `async () => codemode.request(${JSON.stringify({ method: "POST", path: "/api/v1/events/pqc-2026/promotion/renders", body: { fingerprint: personal.fingerprint, publishedRevision: personal.publishedRevision, compositionRevision: personal.compositionRevision, formats: ["portrait"] } })})`,
      );
      expect(queued.isError, JSON.stringify(queued)).not.toBe(true);
      expect(
        promotionKitSchema.parse(JSON.parse((queued.content as Array<{ text: string }>)[0]!.text)).artifacts,
      ).toMatchObject([{ format: "portrait", status: "queued" }]);
    });
  });
  it("refuses a caught operation chain before its first promotion write", async () => {
    await withAuthorizedMcpClient(async (client, grant) => {
      const kit = await prepareAttendeePromotion(grant);
      const operation = promotionSaveOperation(kit);
      const chained = await executeMcp(
        client,
        `async () => { const first = await codemode.request(${JSON.stringify(operation)}); try { await codemode.request({method:"GET",path:"/api/v1/events/pqc-2026/promotion"}); } catch {} return first; }`,
      );
      expect(chained.isError).toBe(true);
      expect(
        await env.DB.prepare("SELECT COUNT(*) AS count FROM event_promotion_kits WHERE user_id=?")
          .bind(grant.userId)
          .first(),
      ).toEqual({ count: 0 });
    });
  });
  it("refuses promotion writes atomically when no selected MCP permission remains", async () => {
    await withAuthorizedMcpClient(async (_client, grant) => {
      const kit = await prepareAttendeePromotion(grant);
      const operation = promotionSaveOperation(kit);
      const saved = await callApi(
        env,
        operation.path,
        {
          method: operation.method,
          headers: { cookie: `pkic_session=${grant.userToken}`, "content-type": "application/json" },
          body: JSON.stringify(operation.body),
        },
        { maxRoundTrips: 1 },
      );
      expect(saved.status, await saved.clone().text()).toBe(200);
      const referencePermissions = await queryAll<{
        id: string;
        role_id: string;
        permission: string;
        created_at: string;
      }>(
        env.DB,
        "SELECT id,role_id,permission,created_at FROM role_permissions WHERE permission IN('forms:read','organizations:read','users:read')",
      );
      try {
        await env.DB.prepare(
          "DELETE FROM role_permissions WHERE permission IN('forms:read','organizations:read','users:read')",
        ).run();
        const refused = await callApi(
          env,
          MCP_PATH,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${grant.access_token}`,
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: {
                name: "execute",
                arguments: {
                  code: `async () => codemode.request(${JSON.stringify({ ...operation, body: { ...operation.body, expectedRevision: 1 } })})`,
                },
              },
            }),
          },
          { maxRoundTrips: 1 },
        );
        expect(refused.status, await refused.clone().text()).toBe(401);
        expect(refused.headers.get("www-authenticate")).toContain("invalid_token");
        expect(
          await env.DB.prepare("SELECT revision FROM event_promotion_kits WHERE user_id=?").bind(grant.userId).first(),
        ).toEqual({ revision: 1 });
      } finally {
        await env.DB.batch(
          referencePermissions.map((row) =>
            env.DB.prepare("INSERT INTO role_permissions(id,role_id,permission,created_at) VALUES(?,?,?,?)").bind(
              row.id,
              row.role_id,
              row.permission,
              row.created_at,
            ),
          ),
        );
        expect(
          await queryAll(
            env.DB,
            "SELECT id,role_id,permission,created_at FROM role_permissions WHERE permission IN('forms:read','organizations:read','users:read')",
          ),
        ).toEqual(referencePermissions);
      }
    });
  });
  it("issues only the approved subset and keeps refresh downscoping", async () => {
    const grant = await authorize();
    expect(new Set(grant.scope.split(" "))).toEqual(new Set(["forms:read", "organizations:read", "users:read"]));
    const refreshed = await exchange({
      grant_type: "refresh_token",
      client_id: grant.clientId,
      refresh_token: grant.refresh_token,
      scope: "forms:read",
    });
    expect(refreshed.status).toBe(200);
    const tokens = (await refreshed.json()) as { scope: string; refresh_token: string };
    expect(tokens.scope).toBe("forms:read");
    const expanded = await exchange({
      grant_type: "refresh_token",
      client_id: grant.clientId,
      refresh_token: tokens.refresh_token,
      scope: "forms:write",
    });
    expect(expanded.status).toBe(400);
  });

  it("revokes an existing access token and its refresh through the owner route", async () => {
    const grant = await authorize();
    const headers = { cookie: `pkic_session=${grant.userToken}` };
    const review = await call(`/api/v1/auth/oauth/authorizations/${grant.authorizationId}`, { headers });
    const { authorization } = (await review.json()) as { authorization: { revision: string } };
    const revoked = await call(`/api/v1/auth/oauth/authorizations/${grant.authorizationId}/revoke`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ revision: authorization.revision }),
    });
    expect(revoked.status).toBe(200);
    expect((await initialize(grant.access_token)).status).toBe(401);
    const refresh = await exchange({
      grant_type: "refresh_token",
      client_id: grant.clientId,
      refresh_token: grant.refresh_token,
    });
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toMatchObject({ error: "invalid_grant" });
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
      const [revoked] = await queryAll<{ revoked_at: string | null }>(
        env.DB,
        "SELECT revoked_at FROM sessions WHERE id = ?",
        [session.id],
      );
      expect(revoked.revoked_at).toBeNull();
      const context = createExecutionContext();
      const portal = await app.fetch(
        new Request(`${origin}/api/v1/auth/session`, { headers: { cookie: `pkic_session=${grant.userToken}` } }),
        env,
        context,
      );
      await waitOnExecutionContext(context);
      expect(portal.status).toBe(401);
      expect(await portal.json()).toMatchObject({ error: { code: "AUTH_EXPIRED" } });
      expect((await initialize(grant.access_token)).status).toBe(401);

      const newGrant = await authorize();
      expect((await initialize(newGrant.access_token)).status).toBe(200);
    },
  );

  it.each(["request", "refresh"])("keeps an active portal session after grant expiry through %s", async (path) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const authorizedAt = Date.now();
    const grant = await authorize();
    const external = await resolveMcpExternalToken({
      token: grant.userToken,
      request: new Request(`${origin}${MCP_PATH}`),
      env,
    });
    expect(external?.props.identityType).toBe("user");
    vi.setSystemTime(authorizedAt + 30 * 60 * 1000);
    const activePortal = await call("/api/v1/auth/session", { headers: { "x-user-token": grant.userToken } });
    expect(activePortal.status).toBe(200);
    const activeToken = activePortal.headers.get("x-user-token")!;
    expect(activeToken).toBeTruthy();

    vi.setSystemTime(authorizedAt + 61 * 60 * 1000);
    if (path === "request") {
      // Access-token expiry can reject before the handler; also exercise its
      // session gate so this case proves that neither path revokes the portal.
      await expect(resolveActiveMcpSession(env, external!.props)).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
      expect((await initialize(grant.access_token)).status).toBe(401);
    }
    const refresh = await exchange({
      grant_type: "refresh_token",
      client_id: grant.clientId,
      refresh_token: grant.refresh_token,
    });
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toMatchObject({ error: "invalid_grant" });

    const portal = await call("/api/v1/auth/session", { headers: { "x-user-token": activeToken } });
    expect(portal.status).toBe(200);
    const sessions = await queryAll<{ revoked_at: string | null }>(
      env.DB,
      "SELECT revoked_at FROM sessions WHERE user_id = ?",
      [grant.userId],
    );
    expect(sessions).toEqual([{ revoked_at: null }]);
    const renewedGrant = await authorize(portal.headers.get("x-user-token")!);
    expect((await initialize(renewedGrant.access_token)).status).toBe(200);
    expect((await initialize(grant.access_token)).status).toBe(401);
  });

  it("keeps API-key service access independent of human inactivity deadlines", async () => {
    const grant = await resolveMcpExternalToken({
      token: env.ADMIN_API_KEY!,
      request: new Request(`${origin}${MCP_PATH}`),
      env,
    });
    expect(grant?.props.identityType).toBe("service");
    expect(await resolveActiveMcpSession(env, grant!.props)).toMatchObject({ remainingSeconds: null });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    expect(await resolveActiveMcpSession(env, grant!.props)).toMatchObject({ remainingSeconds: null });
  });

  it.each(["authorization_code", "refresh_token"] as const)(
    "handles the KV lifetime boundary during %s exchange",
    async (flow) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      // Fake timers do not affect the KV simulator's clock. Keep the frozen
      // application clock ahead so setup latency cannot invalidate native KV writes.
      // https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/
      vi.setSystemTime(Math.ceil(Date.now() / 1000) * 1000 + 60_000);
      for (const remainingSeconds of [59, 60]) {
        const grant = flow === "authorization_code" ? await createAuthorization() : await authorize();
        await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ? AND revoked_at IS NULL")
          .bind(new Date(Date.now() + remainingSeconds * 1000).toISOString(), grant.userId)
          .run();
        const tokens =
          "refresh_token" in grant && typeof grant.refresh_token === "string"
            ? await exchange({
                grant_type: "refresh_token",
                client_id: grant.clientId,
                refresh_token: grant.refresh_token,
              })
            : await redeemCode(grant);
        if (remainingSeconds < 60) {
          expect(tokens.status).toBe(400);
          expect(await tokens.json()).toMatchObject({ error: "invalid_grant" });
        } else {
          expect(tokens.status).toBe(200);
          expect(await tokens.json()).toMatchObject({ expires_in: 60 });
        }
      }
      expect((await initialize((await authorize()).access_token)).status).toBe(200);
    },
  );

  it.each([401, 403, 503, null])("handles a %s failure in the second human session lookup", async (status) => {
    const grant = await authorize();
    const failure =
      status === null
        ? new Error("Session storage is unavailable")
        : new AppError(status, "SESSION_LOOKUP_FAILED", "Session lookup failed");
    const prepare = env.DB.prepare.bind(env.DB);
    let sessionReads = 0;
    vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      if (/\b(?:FROM|JOIN) sessions\b/u.test(sql) && ++sessionReads === 2) throw failure;
      return prepare(sql);
    });
    const lookup = resolveMcpExternalToken({
      token: grant.userToken,
      request: new Request(`${origin}${MCP_PATH}`),
      env,
    });
    if (status === 401 || status === 403) await expect(lookup).resolves.toBeNull();
    else await expect(lookup).rejects.toBe(failure);
    expect(sessionReads).toBe(2);
  });

  it("rejects invalid external credentials without turning them into server failures", async () => {
    expect(
      await resolveMcpExternalToken({ token: "invalid-credential", request: new Request(`${origin}${MCP_PATH}`), env }),
    ).toBeNull();
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
    const tokens = (await refreshed.json()) as { expires_in: number; scope: string };
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.expires_in).toBeLessThanOrEqual(120);
  });
});
