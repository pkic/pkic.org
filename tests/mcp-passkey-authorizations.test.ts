import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { signInWithPasskey } from "./helpers/passkey-sign-in";
import { createMcpOauthTestClient } from "./helpers/mcp-oauth";
import { verifyUserSessionToken, signUserSessionToken } from "../functions/_lib/auth/user-session-token";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { approveOauthAuthorization } from "../functions/_lib/services/oauth-authorizations/approval";
import { resolveUserSessionFromRequest } from "../functions/_lib/auth/user-session";
import { mcpPasskeyAuthorizationTtlSeconds } from "../functions/_lib/auth/oauth/policy";

const env = { ...workerEnv, INTERNAL_SIGNING_SECRET: "synthetic-oauth-test-signing-secret-32-plus" };
const client = createMcpOauthTestClient(env);
let emailToken: string;

describe("passkey-backed MCP authorization lifetimes", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const [user] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email=?", [
      "admin@pkic.org",
    ]);
    await env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?")
      .bind(new Date().toISOString(), user.id)
      .run();
    emailToken = await createAdminSession(env.DB, user.id, crypto.randomUUID(), env.INTERNAL_SIGNING_SECRET);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps existing email sessions short even after a passkey is registered, and extends only verified passkey sign-in", async () => {
    const passkey = await signInWithPasskey(env, emailToken);
    const short = await client.authorize(emailToken);
    const long = await client.authorize(passkey.token);
    const rows = await queryAll<{ id: string; expires_at: string }>(
      env.DB,
      "SELECT id,expires_at FROM oauth_authorizations WHERE id IN (?,?)",
      [short.authorizationId, long.authorizationId],
    );
    const expiry = (id: string) => Date.parse(rows.find((row) => row.id === id)!.expires_at);
    expect(expiry(short.authorizationId) - Date.now()).toBeLessThanOrEqual(3600000);
    expect(expiry(long.authorizationId) - Date.now()).toBeGreaterThan(7 * 3600000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 65 * 60000);
    const refresh = (grant: typeof short) =>
      client.exchange({ grant_type: "refresh_token", client_id: grant.clientId, refresh_token: grant.refresh_token });
    expect((await refresh(short)).status).toBe(400);
    const refreshed = await refresh(long);
    expect(refreshed.status).toBe(200);
    const tokens = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect((await client.initialize(tokens.access_token)).status).toBe(200);
    vi.setSystemTime(Date.now() + 7 * 3600000);
    expect(
      (
        await client.exchange({
          grant_type: "refresh_token",
          client_id: long.clientId,
          refresh_token: tokens.refresh_token,
        })
      ).status,
    ).toBe(400);
  });

  it("preserves immutable passkey evidence through normal session renewal", async () => {
    const passkey = await signInWithPasskey(env, emailToken);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 30 * 60000);
    const refreshed = await client.call("/api/v1/auth/session", { headers: { "x-user-token": passkey.token } });
    expect(refreshed.status).toBe(200);
    const renewed = refreshed.headers.get("x-user-token")!;
    const proof = await verifyUserSessionToken(env.INTERNAL_SIGNING_SECRET, renewed);
    expect(proof.ok && proof.claims.passkeyAuthentication).toEqual(passkey.authentication);
    expect(await refreshed.json()).not.toHaveProperty("passkeyAuthentication");
    const grant = await client.authorize(renewed);
    expect((await client.initialize(grant.access_token)).status).toBe(200);
    const [row] = await queryAll<{ expires_at: string }>(
      env.DB,
      "SELECT expires_at FROM oauth_authorizations WHERE id=?",
      [grant.authorizationId],
    );
    expect(Date.parse(row.expires_at)).toBe(Date.parse(passkey.authentication.authenticatedAt) + 8 * 3600000);
  });

  it("invalidates longer access and refresh when its authenticating passkey is revoked", async () => {
    const passkey = await signInWithPasskey(env, emailToken);
    const grant = await client.authorize(passkey.token);
    await env.DB.prepare("UPDATE passkey_credentials SET revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), passkey.credentialId)
      .run();
    expect((await client.initialize(grant.access_token)).status).toBe(401);
    const refresh = await client.exchange({
      grant_type: "refresh_token",
      client_id: grant.clientId,
      refresh_token: grant.refresh_token,
    });
    expect(refresh.status).toBe(400);
    expect(await refresh.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("keeps borrowed or revoked passkey evidence from extending another authorization", async () => {
    const passkey = await signInWithPasskey(env, emailToken);
    const old = await verifyUserSessionToken(env.INTERNAL_SIGNING_SECRET, emailToken);
    if (!old.ok) throw new Error("Missing synthetic email session");
    const borrowed = await signUserSessionToken(env.INTERNAL_SIGNING_SECRET, {
      ...old.claims,
      passkeyAuthentication: passkey.authentication,
    });
    const short = await client.authorize(borrowed);
    const [row] = await queryAll<{ expires_at: string }>(
      env.DB,
      "SELECT expires_at FROM oauth_authorizations WHERE id=?",
      [short.authorizationId],
    );
    expect(Date.parse(row.expires_at) - Date.now()).toBeLessThanOrEqual(3600000);
    await env.DB.prepare("UPDATE passkey_credentials SET revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), passkey.credentialId)
      .run();
    const revoked = await client.authorize(passkey.token);
    const [revokedRow] = await queryAll<{ expires_at: string }>(
      env.DB,
      "SELECT expires_at FROM oauth_authorizations WHERE id=?",
      [revoked.authorizationId],
    );
    expect(Date.parse(revokedRow.expires_at) - Date.now()).toBeLessThanOrEqual(3600000);
  });

  it("rolls back longer approval if passkey revocation wins the atomic command", async () => {
    const passkey = await signInWithPasskey(env, emailToken);
    const session = await resolveUserSessionFromRequest(
      env.DB,
      new Request("https://app.test", {
        headers: { cookie: `pkic_session=${passkey.token}` },
      }),
      env,
    );
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE passkey_credentials SET revoked_at=? WHERE id=?")
        .bind(new Date().toISOString(), passkey.credentialId)
        .run(),
    );
    await expect(
      approveOauthAuthorization(db, {
        request: {
          responseType: "code",
          clientId: "synthetic-race-client",
          redirectUri: "https://client.test/callback",
          scope: ["forms:read"],
          state: "synthetic",
        },
        actor: session.staff!,
        member: null,
        actingIdentityId: null,
        expectedActingIdentityId: null,
        staffIdleExpiresAt: session.staffIdleExpiresAt!,
        passkeyAuthentication: session.passkeyAuthentication,
        clientName: "Synthetic race client",
        selectedScopes: ["forms:read"],
        signingSecret: env.INTERNAL_SIGNING_SECRET,
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_CONTEXT_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM oauth_authorizations")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT authorization_id FROM oauth_authorization_completions")).toHaveLength(0);
  });

  it("allows disabling longer grants and shortening their absolute lifetime through server policy", async () => {
    expect(mcpPasskeyAuthorizationTtlSeconds({ MCP_OAUTH_PASSKEY_AUTHORIZATION_TTL_SECONDS: "0" })).toBe(0);
    expect(mcpPasskeyAuthorizationTtlSeconds({ MCP_OAUTH_PASSKEY_AUTHORIZATION_TTL_SECONDS: "7200" })).toBe(7200);
    for (const invalid of ["", "12junk", "-1", "1.5", "Infinity"])
      expect(mcpPasskeyAuthorizationTtlSeconds({ MCP_OAUTH_PASSKEY_AUTHORIZATION_TTL_SECONDS: invalid })).toBe(28800);
    const passkey = await signInWithPasskey(env, emailToken);
    const disabled = createMcpOauthTestClient({ ...env, MCP_OAUTH_PASSKEY_AUTHORIZATION_TTL_SECONDS: "0" });
    const short = await disabled.authorize(passkey.token);
    const [shortRow] = await queryAll<{ expires_at: string }>(
      env.DB,
      "SELECT expires_at FROM oauth_authorizations WHERE id=?",
      [short.authorizationId],
    );
    expect(Date.parse(shortRow.expires_at) - Date.now()).toBeLessThanOrEqual(3600000);
    const limited = createMcpOauthTestClient({ ...env, MCP_OAUTH_PASSKEY_AUTHORIZATION_TTL_SECONDS: "7200" });
    const grant = await limited.authorize(passkey.token);
    const [row] = await queryAll<{ expires_at: string }>(
      env.DB,
      "SELECT expires_at FROM oauth_authorizations WHERE id=?",
      [grant.authorizationId],
    );
    expect(Date.parse(row.expires_at)).toBe(Date.parse(passkey.authentication.authenticatedAt) + 7200000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 125 * 60000);
    // Returning to the default policy cannot extend the original two-hour approval.
    expect(
      (
        await client.exchange({
          grant_type: "refresh_token",
          client_id: grant.clientId,
          refresh_token: grant.refresh_token,
        })
      ).status,
    ).toBe(400);
  });
});
