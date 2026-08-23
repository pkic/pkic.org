/**
 * passkeys.test.ts
 *
 * Passkey Authentication (tests/passkeys.test.ts). Uses the
 * mock authenticator helper (tests/helpers/webauthn-mock-authenticator.ts)
 * to exercise real registration/verification/authentication logic against
 * @simplewebauthn/server rather than mocking it.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { MAX_PASSKEY_CREDENTIALS_PER_USER } from "../assets/shared/constants/passkeys";
import { persistVerifiedPasskeyCredential } from "../functions/_lib/services/passkeys";
import { passkeyAuthenticateCompleteResponseSchema } from "../assets/shared/schemas/passkeys";
import {
  buildAuthenticationResponse,
  buildRegistrationResponse,
  createMockAuthenticator,
  type MockAuthenticator,
} from "./helpers/webauthn-mock-authenticator";

const RP_ID = "app.test";
const ORIGIN = "https://app.test";

function request(path: string, init: RequestInit = {}, token?: string): Request {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(`https://${RP_ID}${path}`, { ...init, headers });
}

async function call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  return app.fetch(
    request(path, init, token),
    env as any,
    {
      passThroughOnException: () => {},
      waitUntil: () => {},
    } as any,
  );
}

async function insertStaffUser(email: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, email, email)
    .run();
  return id;
}

/** Org-less (H5) active member — INDIVIDUAL_MEMBERSHIP_CATEGORIES, avoids an organizations row. */
async function insertActiveMemberUser(email: string): Promise<string> {
  const userId = crypto.randomUUID();
  const { statements } = buildCreateIndividualMemberStatements(env.DB, userId, "H5", new Date().toISOString());
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, first_name, role, active, created_at, updated_at)
       VALUES (?, ?, ?, 'Test', 'user', 1, datetime('now'), datetime('now'))`,
    ).bind(userId, email, email),
    ...statements,
  ]);
  return userId;
}

interface BeginResponse {
  options: { challenge: string; rp?: { id?: string } };
  challengeToken: string;
}

async function beginAuthentication(): Promise<BeginResponse> {
  const response = await call("/api/v1/auth/passkeys/authenticate/begin");
  expect(response.status).toBe(200);
  return (await response.json()) as BeginResponse;
}

describe("passkeys (WebAuthn)", () => {
  let userId: string;
  let token: string;

  beforeEach(async () => {
    await resetDb();
    userId = await insertStaffUser("passkey-user@example.test");
    token = await createAdminSession(env.DB, userId, "passkey-user-token");
  });

  async function registerPasskey(
    deviceName = "Test device",
  ): Promise<{ passkeyId: string; authenticator: MockAuthenticator }> {
    const beginResponse = await call("/api/v1/auth/passkeys/register/begin", { method: "POST" }, token);
    expect(beginResponse.status).toBe(200);
    const begin = (await beginResponse.json()) as BeginResponse;

    const authenticator = await createMockAuthenticator();
    const credentialResponse = await buildRegistrationResponse(authenticator, {
      challenge: begin.options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
    });

    const completeResponse = await call(
      "/api/v1/auth/passkeys/register/complete",
      {
        method: "POST",
        body: JSON.stringify({ challengeToken: begin.challengeToken, response: credentialResponse, deviceName }),
      },
      token,
    );
    expect(completeResponse.status).toBe(201);
    const passkey = (await completeResponse.json()) as { id: string };
    return { passkeyId: passkey.id, authenticator };
  }

  it("POST register/begin returns PublicKeyCredentialCreationOptions for an authenticated user; unauthenticated -> 401", async () => {
    const unauthenticated = await call("/api/v1/auth/passkeys/register/begin", { method: "POST" });
    expect(unauthenticated.status).toBe(401);

    const response = await call("/api/v1/auth/passkeys/register/begin", { method: "POST" }, token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as BeginResponse;
    expect(body.options.challenge).toBeTruthy();
    expect(body.options.rp?.id).toBe(RP_ID);
    expect(body.challengeToken).toBeTruthy();
  });

  it("rejects the shared API key from user-owned passkey endpoints", async () => {
    const apiKey = env.ADMIN_API_KEY ?? "test-admin-key";
    const beginResponse = await call("/api/v1/auth/passkeys/register/begin", { method: "POST" }, apiKey);
    const listResponse = await call("/api/v1/auth/passkeys", {}, apiKey);

    for (const response of [beginResponse, listResponse]) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "USER_BACKED_ADMIN_REQUIRED" } });
    }
    await expect(queryAll(env.DB, "SELECT id FROM passkey_credentials")).resolves.toHaveLength(0);
    await expect(
      queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'passkey_registered'"),
    ).resolves.toHaveLength(0);
  });

  it("bounds active credentials consistently at registration and listing", async () => {
    for (let index = 0; index < MAX_PASSKEY_CREDENTIALS_PER_USER; index++) {
      await env.DB.prepare(
        `INSERT INTO passkey_credentials
           (id, user_id, credential_id, public_key, sign_count, device_name, created_at)
         VALUES (?, ?, ?, ?, 0, ?, datetime('now', ?))`,
      )
        .bind(crypto.randomUUID(), userId, `credential-${index}`, "AQ", `Device ${index}`, `-${index} seconds`)
        .run();
    }

    const beginResponse = await call("/api/v1/auth/passkeys/register/begin", { method: "POST" }, token);
    expect(beginResponse.status).toBe(409);
    const beginBody = (await beginResponse.json()) as { error: { code: string } };
    expect(beginBody.error.code).toBe("PASSKEY_LIMIT_REACHED");

    const listResponse = await call("/api/v1/auth/passkeys", {}, token);
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { passkeys: Array<{ id: string }> };
    expect(list.passkeys).toHaveLength(MAX_PASSKEY_CREDENTIALS_PER_USER);
  });

  it("atomically allows only one concurrent credential to claim the final active slot", async () => {
    for (let index = 0; index < MAX_PASSKEY_CREDENTIALS_PER_USER - 1; index++) {
      await env.DB.prepare(
        `INSERT INTO passkey_credentials
           (id, user_id, credential_id, public_key, sign_count, device_name, created_at)
         VALUES (?, ?, ?, ?, 0, ?, datetime('now', ?))`,
      )
        .bind(crypto.randomUUID(), userId, `existing-${index}`, "AQ", `Existing ${index}`, `-${index} seconds`)
        .run();
    }

    const persist = (suffix: string) =>
      persistVerifiedPasskeyCredential(
        env.DB,
        { id: userId, kind: "admin" },
        {
          credentialId: `final-slot-${suffix}`,
          publicKey: "AQ",
          signCount: 0,
          aaguid: null,
          deviceName: `Final ${suffix}`,
        },
      );
    const results = await Promise.allSettled([persist("one"), persist("two")]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ code: "PASSKEY_LIMIT_REACHED" }),
    });
    const active = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM passkey_credentials WHERE user_id = ? AND revoked_at IS NULL",
      userId,
    );
    expect(active).toHaveLength(MAX_PASSKEY_CREDENTIALS_PER_USER);
  });

  it("POST register/complete with a valid mock credential creates a passkey_credentials record; invalid credential -> 400", async () => {
    const { passkeyId } = await registerPasskey("Laptop");

    const rows = await queryAll<{ id: string; user_id: string; device_name: string; sign_count: number }>(
      env.DB,
      "SELECT id, user_id, device_name, sign_count FROM passkey_credentials WHERE id = ?",
      passkeyId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userId);
    expect(rows[0].device_name).toBe("Laptop");
    expect(rows[0].sign_count).toBe(0);

    const beginResponse = await call("/api/v1/auth/passkeys/register/begin", { method: "POST" }, token);
    const begin = (await beginResponse.json()) as BeginResponse;

    const invalidResponse = await call(
      "/api/v1/auth/passkeys/register/complete",
      {
        method: "POST",
        body: JSON.stringify({
          challengeToken: begin.challengeToken,
          response: {
            id: "bm90LWEtcmVhbC1jcmVkZW50aWFs",
            rawId: "bm90LWEtcmVhbC1jcmVkZW50aWFs",
            response: {
              clientDataJSON: btoa(
                JSON.stringify({ type: "webauthn.create", challenge: "wrong-challenge", origin: ORIGIN }),
              ),
              attestationObject: "bm90LWEtcmVhbC1hdHRlc3RhdGlvbg",
            },
            clientExtensionResults: {},
            type: "public-key",
          },
        }),
      },
      token,
    );
    expect(invalidResponse.status).toBe(400);
  });

  it("GET authenticate/begin returns a valid challenge, no auth required", async () => {
    const begin = await beginAuthentication();
    expect(begin.options.challenge).toBeTruthy();
    expect(begin.challengeToken).toBeTruthy();
  });

  it("POST authenticate/complete with a valid signed assertion creates a session; a replayed assertion (sign_count not incremented) -> 400", async () => {
    const { authenticator } = await registerPasskey();

    const begin = await beginAuthentication();
    const assertion = await buildAuthenticationResponse(authenticator, {
      challenge: begin.options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
      signCount: 1,
    });

    const completeResponse = await call("/api/v1/auth/passkeys/authenticate/complete", {
      method: "POST",
      body: JSON.stringify({ challengeToken: begin.challengeToken, response: assertion }),
    });
    expect(completeResponse.status).toBe(200);
    const body = passkeyAuthenticateCompleteResponseSchema.parse(await completeResponse.json());
    expect(body.success).toBe(true);
    expect("admin" in body).toBe(true);
    if (!("admin" in body)) throw new Error("Expected an admin passkey session");
    expect(body.admin.id).toBe(userId);
    expect(body.admin).not.toHaveProperty("identityType");
    expect(body.admin).not.toHaveProperty("sessionId");
    expect(body.admin).not.toHaveProperty("state");
    const adminCookie = completeResponse.headers.get("set-cookie") ?? "";
    expect(adminCookie).toContain("pkic_admin_session=");
    expect(adminCookie).toContain("Path=/api/v1");
    expect(adminCookie).toContain("HttpOnly");
    expect(adminCookie).toContain("SameSite=Strict");
    expect(adminCookie).toContain("Secure");
    expect(adminCookie).not.toContain("pkic_member_session=");
    expect(completeResponse.headers.get("cache-control")).toBe("no-store, max-age=0");

    const rows = await queryAll<{ sign_count: number }>(
      env.DB,
      "SELECT sign_count FROM passkey_credentials WHERE user_id = ?",
      userId,
    );
    expect(rows[0].sign_count).toBe(1);

    // Replaying the identical assertion presents the same sign count again,
    // which must be rejected as a possible cloned-credential replay.
    const replayResponse = await call("/api/v1/auth/passkeys/authenticate/complete", {
      method: "POST",
      body: JSON.stringify({ challengeToken: begin.challengeToken, response: assertion }),
    });
    expect(replayResponse.status).toBe(400);
  });

  it("allows a signed assertion to create only one session when the same request completes concurrently", async () => {
    const { authenticator } = await registerPasskey();
    const begin = await beginAuthentication();
    const assertion = await buildAuthenticationResponse(authenticator, {
      challenge: begin.options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
      signCount: 1,
    });
    const sessionsBefore = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?",
      userId,
    );

    const complete = () =>
      call("/api/v1/auth/passkeys/authenticate/complete", {
        method: "POST",
        body: JSON.stringify({ challengeToken: begin.challengeToken, response: assertion }),
      });
    const responses = await Promise.all([complete(), complete()]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    const sessionsAfter = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM sessions WHERE user_id = ?",
      userId,
    );
    expect(sessionsAfter[0].total - sessionsBefore[0].total).toBe(1);
    expect(
      await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'passkey_authenticated' AND actor_id = ?",
        userId,
      ),
    ).toEqual([{ total: 1 }]);
  });

  it("rejects reuse of a consumed challenge when an authenticator does not support a signature counter", async () => {
    const { authenticator } = await registerPasskey();
    await env.DB.prepare(
      `INSERT INTO passkey_challenge_uses (challenge_id, purpose, used_at, expires_at)
       VALUES ('expired-test-challenge', 'authentication', datetime('now', '-10 minutes'), datetime('now', '-5 minutes'))`,
    ).run();
    const begin = await beginAuthentication();
    const assertion = await buildAuthenticationResponse(authenticator, {
      challenge: begin.options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
      signCount: 0,
    });
    const complete = () =>
      call("/api/v1/auth/passkeys/authenticate/complete", {
        method: "POST",
        body: JSON.stringify({ challengeToken: begin.challengeToken, response: assertion }),
      });

    expect((await complete()).status).toBe(200);
    const replay = await complete();
    expect(replay.status).toBe(400);
    await expect(replay.json()).resolves.toMatchObject({ error: { code: "PASSKEY_CHALLENGE_INVALID" } });
    expect(
      await queryAll<{ total: number }>(
        env.DB,
        "SELECT COUNT(*) AS total FROM passkey_challenge_uses WHERE purpose = 'authentication'",
      ),
    ).toEqual([{ total: 1 }]);
  });

  it("sign count is incremented after each successful assertion (clone attack detection)", async () => {
    const { authenticator } = await registerPasskey();

    for (const signCount of [1, 2, 3]) {
      const begin = await beginAuthentication();
      const assertion = await buildAuthenticationResponse(authenticator, {
        challenge: begin.options.challenge,
        rpId: RP_ID,
        origin: ORIGIN,
        signCount,
      });
      const response = await call("/api/v1/auth/passkeys/authenticate/complete", {
        method: "POST",
        body: JSON.stringify({ challengeToken: begin.challengeToken, response: assertion }),
      });
      expect(response.status).toBe(200);
    }

    const rows = await queryAll<{ sign_count: number }>(
      env.DB,
      "SELECT sign_count FROM passkey_credentials WHERE user_id = ?",
      userId,
    );
    expect(rows[0].sign_count).toBe(3);
  });

  it("GET /passkeys returns the authenticated user's passkeys with no private key material", async () => {
    const { passkeyId } = await registerPasskey("Yubikey");

    const response = await call("/api/v1/auth/passkeys", {}, token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { passkeys: Array<Record<string, unknown>> };
    expect(body.passkeys).toHaveLength(1);
    expect(body.passkeys[0].id).toBe(passkeyId);
    expect(body.passkeys[0].deviceName).toBe("Yubikey");
    expect(body.passkeys[0]).not.toHaveProperty("publicKey");
    expect(body.passkeys[0]).not.toHaveProperty("credentialId");
    expect(body.passkeys[0]).not.toHaveProperty("credential_id");
  });

  it("DELETE /passkeys/:id sets revoked_at; a user cannot delete another user's passkey", async () => {
    const { passkeyId } = await registerPasskey();
    const otherUserId = await insertStaffUser("other-passkey-user@example.test");
    const otherToken = await createAdminSession(env.DB, otherUserId, "other-passkey-user-token");

    const deniedResponse = await call(`/api/v1/auth/passkeys/${passkeyId}`, { method: "DELETE" }, otherToken);
    expect(deniedResponse.status).toBe(403);

    const allowedResponse = await call(`/api/v1/auth/passkeys/${passkeyId}`, { method: "DELETE" }, token);
    expect(allowedResponse.status).toBe(200);

    const rows = await queryAll<{ revoked_at: string | null }>(
      env.DB,
      "SELECT revoked_at FROM passkey_credentials WHERE id = ?",
      passkeyId,
    );
    expect(rows[0].revoked_at).not.toBeNull();
  });

  it("a user cannot authenticate with a revoked passkey", async () => {
    const { passkeyId, authenticator } = await registerPasskey();
    const revokeResponse = await call(`/api/v1/auth/passkeys/${passkeyId}`, { method: "DELETE" }, token);
    expect(revokeResponse.status).toBe(200);

    const begin = await beginAuthentication();
    const assertion = await buildAuthenticationResponse(authenticator, {
      challenge: begin.options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
      signCount: 1,
    });

    const response = await call("/api/v1/auth/passkeys/authenticate/complete", {
      method: "POST",
      body: JSON.stringify({ challengeToken: begin.challengeToken, response: assertion }),
    });
    expect(response.status).toBe(400);
  });
});

describe("member passkey login (generalizing passkeys beyond staff)", () => {
  let memberUserId: string;
  let memberToken: string;

  beforeEach(async () => {
    await resetDb();
    memberUserId = await insertActiveMemberUser("member-passkey@example.test");
    memberToken = await createMemberSession(env.DB, memberUserId, "member-passkey-token");
  });

  it("a member session can register a passkey via the same endpoints as staff", async () => {
    const beginResponse = await call("/api/v1/auth/passkeys/register/begin", { method: "POST" }, memberToken);
    expect(beginResponse.status).toBe(200);
    const begin = (await beginResponse.json()) as BeginResponse;

    const authenticator = await createMockAuthenticator();
    const credentialResponse = await buildRegistrationResponse(authenticator, {
      challenge: begin.options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
    });

    const completeResponse = await call(
      "/api/v1/auth/passkeys/register/complete",
      {
        method: "POST",
        body: JSON.stringify({ challengeToken: begin.challengeToken, response: credentialResponse }),
      },
      memberToken,
    );
    expect(completeResponse.status).toBe(201);

    const rows = await queryAll<{ user_id: string }>(
      env.DB,
      "SELECT user_id FROM passkey_credentials WHERE user_id = ?",
      memberUserId,
    );
    expect(rows).toHaveLength(1);

    const listResponse = await call("/api/v1/auth/passkeys", {}, memberToken);
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { passkeys: Array<{ id: string }> };
    expect(list.passkeys).toHaveLength(1);
  });

  it("authenticate/complete for a member-owned passkey issues a member session, not an admin one", async () => {
    const beginResponse = await call("/api/v1/auth/passkeys/register/begin", { method: "POST" }, memberToken);
    const begin = (await beginResponse.json()) as BeginResponse;
    const authenticator = await createMockAuthenticator();
    const credentialResponse = await buildRegistrationResponse(authenticator, {
      challenge: begin.options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
    });
    await call(
      "/api/v1/auth/passkeys/register/complete",
      { method: "POST", body: JSON.stringify({ challengeToken: begin.challengeToken, response: credentialResponse }) },
      memberToken,
    );

    const authBegin = await beginAuthentication();
    const assertion = await buildAuthenticationResponse(authenticator, {
      challenge: authBegin.options.challenge,
      rpId: RP_ID,
      origin: ORIGIN,
      signCount: 1,
    });

    const completeResponse = await call("/api/v1/auth/passkeys/authenticate/complete", {
      method: "POST",
      body: JSON.stringify({ challengeToken: authBegin.challengeToken, response: assertion }),
    });
    expect(completeResponse.status).toBe(200);
    const body = (await completeResponse.json()) as { success: boolean; member?: { userId: string }; admin?: unknown };
    expect(body.success).toBe(true);
    expect(body.member?.userId).toBe(memberUserId);
    expect(body.admin).toBeUndefined();
    const memberCookie = completeResponse.headers.get("set-cookie") ?? "";
    expect(memberCookie).toContain("pkic_member_session=");
    expect(memberCookie).toContain("Path=/api/v1");
    expect(memberCookie).toContain("HttpOnly");
    expect(memberCookie).toContain("SameSite=Strict");
    expect(memberCookie).toContain("Secure");
    expect(memberCookie).not.toContain("pkic_admin_session=");
    expect(completeResponse.headers.get("cache-control")).toBe("no-store, max-age=0");
  });
});
