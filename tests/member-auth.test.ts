/**
 * member-auth.test.ts
 *
 * member-facing magic-link authentication
 * (functions/_lib/auth/member.ts) — a parallel path to admin auth, gated on
 * holding an active `members` row rather than staff role/grants.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { onRequestPost as verifyMemberLink } from "../functions/api/v1/auth/member/verify-link";
import { resetDb } from "./helpers/reset-db";
import { createMemberSession } from "./helpers/auth";
import { createContext, deliveredEmailPayload, queryAll } from "./helpers/context";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { insertIndividualMember } from "./helpers/membership";

function request(path: string, init: RequestInit = {}, token?: string): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  return app.fetch(
    request(path, init, token),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function insertActiveMember(email: string, category = "H5"): Promise<string> {
  const { userId } = await insertIndividualMember(env.DB, category, email);
  return userId;
}

describe("Member auth", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("requests a magic link for an active member and it verifies into a session", async () => {
    await insertActiveMember("jane@example.test");

    const requestResponse = await call("/api/v1/auth/member/request-link", {
      method: "POST",
      body: JSON.stringify({ email: "jane@example.test" }),
    });
    expect(requestResponse.status).toBe(200);

    const outboxRows = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'member_magic_link' ORDER BY created_at DESC LIMIT 1",
    );
    expect(outboxRows).toHaveLength(1);
    const storedPayload = JSON.parse(outboxRows[0].payload_json) as {
      magicLinkUrl: string;
      __authorizedCapabilityMarkers?: unknown[];
    };
    expect(storedPayload.magicLinkUrl).toMatch(/pkcq1_/);
    expect(storedPayload.__authorizedCapabilityMarkers).toHaveLength(1);
    const payload = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outboxRows[0].payload_json);
    const token = new URL(payload.magicLinkUrl).searchParams.get("token");
    expect(token).toBeTruthy();

    const verifyResponse = await call("/api/v1/auth/member/verify-link", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    expect(verifyResponse.status).toBe(200);
    const verifyBody = (await verifyResponse.json()) as { success: boolean; member: { email: string } };
    expect(verifyBody.success).toBe(true);
    expect(verifyBody.member.email).toBe("jane@example.test");
  });

  it("rejects a capability when the member is no longer eligible", async () => {
    const userId = await insertActiveMember("eligibility-before-link@example.test");
    const requestResponse = await call("/api/v1/auth/member/request-link", {
      method: "POST",
      body: JSON.stringify({ email: "eligibility-before-link@example.test" }),
    });
    expect(requestResponse.status).toBe(200);
    const [outbox] = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'member_magic_link' ORDER BY rowid DESC LIMIT 1",
    );
    const payload = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
    const token = new URL(payload.magicLinkUrl).searchParams.get("token")!;

    await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE user_id = ?").bind(userId).run();
    await expect(
      call("/api/v1/auth/member/verify-link", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
    ).resolves.toMatchObject({ status: 403 });
  });

  it("rolls back redemption when membership eligibility changes before the commit statements run", async () => {
    const userId = await insertActiveMember("eligibility-during-redemption@example.test");
    const requestResponse = await call("/api/v1/auth/member/request-link", {
      method: "POST",
      body: JSON.stringify({ email: "eligibility-during-redemption@example.test" }),
    });
    expect(requestResponse.status).toBe(200);
    const [outbox] = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'member_magic_link' ORDER BY rowid DESC LIMIT 1",
    );
    const payload = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
    const token = new URL(payload.magicLinkUrl).searchParams.get("token")!;

    const gate = gateNextBatch(env.DB);
    const verificationContext = createContext(
      env,
      new Request("https://app.test/api/v1/auth/member/verify-link", {
        method: "POST",
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
      }),
      {},
    );
    verificationContext.set?.("requestDb", gate.db);
    const staleRedemption = verifyMemberLink(verificationContext);
    await gate.reached;

    await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE user_id = ?").bind(userId).run();
    gate.release();
    await expect(staleRedemption).rejects.toMatchObject({ code: "MAGIC_LINK_INVALID" });
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'member_magic_link_verified'")).toHaveLength(
      0,
    );
    expect(await queryAll<{ status: string }>(env.DB, "SELECT status FROM members WHERE user_id = ?", userId)).toEqual([
      { status: "inactive" },
    ]);
  });

  it("does not error when requesting a link for an unknown/non-member email (no info leak)", async () => {
    const response = await call("/api/v1/auth/member/request-link", {
      method: "POST",
      body: JSON.stringify({ email: "nobody@example.test" }),
    });
    expect(response.status).toBe(200);
    const outboxRows = await queryAll(env.DB, "SELECT id FROM email_outbox WHERE template_key = 'member_magic_link'");
    expect(outboxRows).toHaveLength(0);
  });

  it("a user without an active members row is not eligible for a member session token", async () => {
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'staffonly@example.test', 'staffonly@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(userId)
      .run();

    const token = await createMemberSession(env.DB, userId, "no-member-row-token");
    const response = await call("/api/v1/me", {}, token);
    expect(response.status).toBe(403);
  });

  it("rejects requests to /api/v1/me with no token", async () => {
    const response = await call("/api/v1/me");
    expect(response.status).toBe(401);
  });

  it("an active member session can access /api/v1/me", async () => {
    const userId = await insertActiveMember("session-check@example.test");
    const token = await createMemberSession(env.DB, userId, "session-check-token");

    const response = await call("/api/v1/me", {}, token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { email: string };
    expect(body.email).toBe("session-check@example.test");
  });

  it("logout (cookie-based, matching admin logout's design) revokes the session", async () => {
    const userId = await insertActiveMember("logout-check@example.test");
    const token = await createMemberSession(env.DB, userId, "logout-check-token");
    const cookieHeaders = { cookie: `pkic_member_session=${encodeURIComponent(token)}` };

    const logoutResponse = await call("/api/v1/auth/member/logout", { method: "POST", headers: cookieHeaders });
    expect(logoutResponse.status).toBe(200);

    const meResponse = await call("/api/v1/me", { headers: cookieHeaders });
    expect(meResponse.status).toBe(401);
  });
});
