import { grantAdministrator } from "./helpers/administrator";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  userAuthLogoutRequestSchema,
  userAuthLogoutResponseSchema,
  userAuthSessionResponseSchema,
} from "../assets/shared/schemas/user-auth";
import { signUserSessionToken, verifyUserSessionToken } from "../functions/_lib/auth/user-session";
import { signJwt } from "../functions/_lib/utils/jwt";
import type { Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateAfterNextStatement } from "./helpers/database-races";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const signingSecret = "test-signing-secret";
type Session = { token: string; sessionId: string; userId: string; cookie: string };
let original: Session;
let otherUserId: string;

async function session(userId: string): Promise<Session> {
  const token = await createAdminSession(env.DB, userId, crypto.randomUUID(), signingSecret);
  const verified = await verifyUserSessionToken(signingSecret, token);
  if (!verified.ok) throw new Error("Expected a valid fixture session");
  return { token, userId, sessionId: verified.claims.sid, cookie: `pkic_session=${token}` };
}

function sessionRows() {
  return queryAll(env.DB, "SELECT id,user_id,token_hash,expires_at,revoked_at,created_at FROM sessions ORDER BY id");
}

async function logout(expectedSessionId: string, cookie?: string, environment: Env = env) {
  const body = userAuthLogoutRequestSchema.parse({ expectedSessionId });
  const response = await callApi(environment, "/api/v1/auth/logout", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  expect(response.headers.has("set-cookie")).toBe(false);
  return userAuthLogoutResponseSchema.parse(await response.json());
}

async function assertLive(current: Session) {
  const response = await callApi(env, "/api/v1/auth/session", { headers: { cookie: current.cookie } });
  expect(response.status).toBe(200);
  const body = userAuthSessionResponseSchema.parse(await response.json());
  expect(body.sessionId).toBe(current.sessionId);
  expect(body.identity.id).toBe(current.userId);
  return body;
}

describe("Exact user session logout", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    original = await session(admin.id);
    otherUserId = await insertUser(env.DB, "other-session-owner@example.test");
    await grantAdministrator(env.DB, otherUserId);
  });

  it("exposes the exact common session ID for staff without a member capacity", async () => {
    const body = await assertLive(original);
    expect(body.staff).toBeDefined();
    expect(body.member).toBeUndefined();
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("cookie");
  });

  it("revokes only the authenticated exact instance and retries without changing its end time", async () => {
    const independent = await session(original.userId);
    const unrelatedBefore = await queryAll(env.DB, "SELECT id,revoked_at FROM sessions WHERE id=?", [
      independent.sessionId,
    ]);
    expect(await logout(original.sessionId, original.cookie)).toEqual({ success: true, outcome: "revoked" });
    const ended = await sessionRows();
    expect(ended.find((row) => row.id === original.sessionId)?.revoked_at).toEqual(expect.any(String));
    expect(await queryAll(env.DB, "SELECT id,revoked_at FROM sessions WHERE id=?", [independent.sessionId])).toEqual(
      unrelatedBefore,
    );
    expect(await logout(original.sessionId, original.cookie)).toEqual({ success: true, outcome: "already_ended" });
    expect(await sessionRows()).toEqual(ended);
    expect((await callApi(env, "/api/v1/auth/session", { headers: { cookie: original.cookie } })).status).toBe(401);
    await assertLive(independent);
  });

  it.each(["other owner", "newer same owner"])(
    "does not revoke the %s session when a stale intent arrives",
    async (kind) => {
      const current = await session(kind === "other owner" ? otherUserId : original.userId);
      const before = await sessionRows();
      expect(await logout(original.sessionId, current.cookie)).toEqual({ success: true, outcome: "session_changed" });
      expect(await sessionRows()).toEqual(before);
      await assertLive(current);
      await assertLive(original);
    },
  );

  it("cannot target another session merely by supplying its nonsecret ID", async () => {
    const other = await session(otherUserId);
    const before = await sessionRows();
    expect(await logout(other.sessionId, original.cookie)).toEqual({ success: true, outcome: "session_changed" });
    expect(await sessionRows()).toEqual(before);
    await assertLive(other);
  });

  it("uses the canonical cookie session ahead of a stale bearer token", async () => {
    const current = await session(otherUserId);
    const before = await sessionRows();
    const response = await callApi(env, "/api/v1/auth/logout", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: current.cookie,
        authorization: `Bearer ${original.token}`,
      },
      body: JSON.stringify(userAuthLogoutRequestSchema.parse({ expectedSessionId: original.sessionId })),
    });
    expect(response.status).toBe(200);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(userAuthLogoutResponseSchema.parse(await response.json())).toEqual({
      success: true,
      outcome: "session_changed",
    });
    expect(await sessionRows()).toEqual(before);
  });

  it.each(["other owner", "newer same owner"])(
    "a delayed A request neither revokes nor clears the %s established after its row read",
    async (kind) => {
      let replacement: Session | undefined;
      const db = mutateAfterNextStatement(env.DB, async () => {
        replacement = await session(kind === "other owner" ? otherUserId : original.userId);
      });
      expect(await logout(original.sessionId, original.cookie, { ...env, DB: db })).toEqual({
        success: true,
        outcome: "revoked",
      });
      if (!replacement) throw new Error("Expected the replacement session");
      await assertLive(replacement);
      expect(await queryAll(env.DB, "SELECT revoked_at FROM sessions WHERE id=?", [replacement.sessionId])).toEqual([
        { revoked_at: null },
      ]);
    },
  );

  it("reports concurrent revocation idempotently without rewriting its timestamp", async () => {
    const endedAt = nowIso();
    const db = mutateAfterNextStatement(env.DB, () =>
      env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").bind(endedAt, original.sessionId).run(),
    );
    expect(await logout(original.sessionId, original.cookie, { ...env, DB: db })).toEqual({
      success: true,
      outcome: "already_ended",
    });
    expect(await queryAll(env.DB, "SELECT revoked_at FROM sessions WHERE id=?", [original.sessionId])).toEqual([
      { revoked_at: endedAt },
    ]);
  });

  it("reports an already expired matching row without modifying it", async () => {
    await env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
      .bind(original.sessionId)
      .run();
    const before = await sessionRows();
    expect(await logout(original.sessionId, original.cookie)).toEqual({ success: true, outcome: "already_ended" });
    expect(await sessionRows()).toEqual(before);
  });

  it("does not write when the matching row expires after preflight", async () => {
    const db = mutateAfterNextStatement(env.DB, () =>
      env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
        .bind(original.sessionId)
        .run(),
    );
    expect(await logout(original.sessionId, original.cookie, { ...env, DB: db })).toEqual({
      success: true,
      outcome: "already_ended",
    });
    expect(await queryAll(env.DB, "SELECT revoked_at FROM sessions WHERE id=?", [original.sessionId])).toEqual([
      { revoked_at: null },
    ]);
  });

  it("checks the signed owner again at the write after ownership changes", async () => {
    const db = mutateAfterNextStatement(env.DB, () =>
      env.DB.prepare("UPDATE sessions SET user_id=? WHERE id=?").bind(otherUserId, original.sessionId).run(),
    );
    expect(await logout(original.sessionId, original.cookie, { ...env, DB: db })).toEqual({
      success: true,
      outcome: "no_current_session",
    });
    expect(await queryAll(env.DB, "SELECT user_id,revoked_at FROM sessions WHERE id=?", [original.sessionId])).toEqual([
      { user_id: otherUserId, revoked_at: null },
    ]);
  });

  it.each(["absent", "invalid", "wrong signature", "expired", "wrong token type", "wrong owner", "missing row"])(
    "does not authorize the requested ID using %s credentials",
    async (kind) => {
      let token: string | undefined;
      if (kind === "invalid") token = "invalid-token";
      if (kind === "wrong signature")
        token = await signUserSessionToken("different-secret", {
          sub: original.userId,
          sid: original.sessionId,
          exp: Math.floor(Date.now() / 1000) + 60,
        });
      if (kind === "expired")
        token = await signUserSessionToken(signingSecret, { sub: original.userId, sid: original.sessionId, exp: 1 });
      if (kind === "wrong token type")
        token = await signJwt(signingSecret, {
          typ: "machine-session",
          sub: original.userId,
          sid: original.sessionId,
          exp: Math.floor(Date.now() / 1000) + 60,
        });
      if (kind === "wrong owner" || kind === "missing row")
        token = await signUserSessionToken(signingSecret, {
          sub: kind === "wrong owner" ? otherUserId : original.userId,
          sid: kind === "missing row" ? crypto.randomUUID() : original.sessionId,
          exp: Math.floor(Date.now() / 1000) + 60,
        });
      const before = await sessionRows();
      expect(await logout(original.sessionId, token ? `pkic_session=${token}` : undefined)).toEqual({
        success: true,
        outcome: "no_current_session",
      });
      expect(await sessionRows()).toEqual(before);
      await assertLive(original);
    },
  );

  it.each([
    { expectedSessionId: null },
    { expectedSessionId: "" },
    { expectedSessionId: "invalid" },
    { expectedSessionId: "00000000-0000-4000-8000-000000000001", unexpected: true },
  ])("refuses malformed conditional input without falling back to unguarded logout: %j", async (body) => {
    const before = await sessionRows();
    const response = await callApi(env, "/api/v1/auth/logout", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: original.cookie },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await sessionRows()).toEqual(before);
  });

  it("retains the existing bodyless online logout cookie clearing", async () => {
    const response = await callApi(env, "/api/v1/auth/logout", {
      method: "POST",
      headers: { cookie: original.cookie },
    });
    expect(response.status).toBe(200);
    expect(userAuthLogoutResponseSchema.parse(await response.json())).toEqual({ success: true, outcome: "revoked" });
    expect(response.headers.get("set-cookie")).toContain("pkic_session=;");
    expect((await callApi(env, "/api/v1/auth/session", { headers: { cookie: original.cookie } })).status).toBe(401);
  });
});
