import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import app from "../functions/router";
import { resolveMcpExternalToken } from "../functions/_lib/auth/oauth/authorization";
import { requireActiveMcpSession } from "../functions/_lib/auth/oauth/session-authorization";
import { queryAll } from "./helpers/context";
import { MCP_PATH } from "../functions/_lib/api-tools/mcp-worker";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { origin, call, authorize, createAuthorization, redeemCode, exchange, initialize } from "./helpers/mcp-oauth";
import { AppError } from "../functions/_lib/errors";

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
        new Request(`${origin}/api/v1/auth/session`, { headers: { cookie: grant.cookie } }),
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
      token: grant.cookie.slice("pkic_session=".length),
      request: new Request(`${origin}${MCP_PATH}`),
      env,
    });
    expect(external?.props.identityType).toBe("user");
    vi.setSystemTime(authorizedAt + 30 * 60 * 1000);
    const activePortal = await call("/api/v1/auth/session", {
      headers: { "x-user-token": grant.cookie.slice("pkic_session=".length) },
    });
    expect(activePortal.status).toBe(200);
    const activeToken = activePortal.headers.get("x-user-token")!;
    expect(activeToken).toBeTruthy();

    vi.setSystemTime(authorizedAt + 61 * 60 * 1000);
    if (path === "request") {
      // Access-token expiry can reject before the handler; also exercise its
      // session gate so this case proves that neither path revokes the portal.
      await expect(requireActiveMcpSession(env, external!.props)).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
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
    const renewedGrant = await authorize(undefined, undefined, portal.headers.get("x-user-token")!);
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
    expect(await requireActiveMcpSession(env, grant!.props)).toBeNull();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    expect(await requireActiveMcpSession(env, grant!.props)).toBeNull();
  });

  it.each(["authorization_code", "refresh_token"] as const)(
    "handles the KV lifetime boundary during %s exchange",
    async (flow) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Math.floor(Date.now() / 1000) * 1000);
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
      if (/FROM sessions\b/.test(sql) && ++sessionReads === 2) throw failure;
      return prepare(sql);
    });
    const lookup = resolveMcpExternalToken({
      token: grant.cookie.slice("pkic_session=".length),
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
    const tokens = (await refreshed.json()) as { expires_in: number };
    expect(tokens.expires_in).toBeGreaterThan(0);
    expect(tokens.expires_in).toBeLessThanOrEqual(120);
  });
});
