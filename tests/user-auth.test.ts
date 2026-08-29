import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { createTestRateLimiter, deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import {
  addRepresentative,
  insertIndividualMember,
  insertOrganization,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";

async function call(path: string, init: RequestInit = {}, testEnv = env): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    testEnv as never,
    { passThroughOnException() {}, waitUntil() {} } as any,
  );
}

async function seedDualCapacityUser(): Promise<void> {
  await seedEventAndAdmin(env.DB);
  const [staff] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
    "admin@pkic.org",
  ]);
  const organizationId = await insertOrganization(env.DB, "User auth organization");
  const memberId = await seedOrganizationAggregate(env.DB, organizationId);
  await addRepresentative(env.DB, memberId, staff.id);
}

async function requestUserToken(email: string, headers?: HeadersInit): Promise<string | null> {
  expect(
    await call("/api/v1/auth/request-link", {
      method: "POST",
      body: JSON.stringify({ email }),
      headers,
    }),
  ).toMatchObject({ status: 200 });
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox ORDER BY rowid DESC LIMIT 1",
  );
  if (!outbox) return null;
  const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
  const url = new URL(delivered.magicLinkUrl);
  return new URLSearchParams(url.hash.split("?", 2)[1]).get("token");
}

function cookiePair(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

describe("canonical user authentication", () => {
  beforeEach(resetDb);

  it("materializes and renders a user_sign_in capability into one user session with live staff and member capacities", async () => {
    await seedDualCapacityUser();

    expect(
      await call("/api/v1/auth/request-link", {
        method: "POST",
        body: JSON.stringify({ email: "admin@pkic.org" }),
      }),
    ).toMatchObject({ status: 200 });

    const [outbox] = await queryAll<{ payload_json: string; template_key: string }>(
      env.DB,
      "SELECT payload_json, template_key FROM email_outbox ORDER BY rowid DESC LIMIT 1",
    );
    expect(outbox.template_key).toBe("user_magic_link");
    const stored = JSON.parse(outbox.payload_json) as { __authorizedCapabilityMarkers?: string[] };
    expect(stored.__authorizedCapabilityMarkers?.[0]).toContain("dXNp");
    const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
    const deliveredUrl = new URL(delivered.magicLinkUrl);
    const token = new URLSearchParams(deliveredUrl.hash.split("?", 2)[1]).get("token");
    if (!token) throw new Error("Missing user sign-in capability token");
    expect(token).toMatch(/^pkc1_/);

    const verified = await call("/api/v1/auth/verify-link", {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "issuer" },
    });
    expect(verified.status).toBe(200);
    const body = (await verified.json()) as { identity: { email: string }; staff?: unknown; member?: unknown };
    expect(body.identity.email).toBe("admin@pkic.org");
    expect(body.staff).toBeTruthy();
    expect(body.member).toBeTruthy();
    const cookie = verified.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pkic_session=");
    expect(cookie).not.toMatch(/pkic_(?:admin|member)_session=/);

    const session = await call("/api/v1/auth/session", { headers: { cookie } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      identity: { email: "admin@pkic.org" },
      staff: expect.any(Object),
      member: expect.any(Object),
    });
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toHaveLength(1);
  });

  it.each(["/api/v1/admin/auth/request-link", "/api/v1/auth/member/request-link", "/api/v1/auth/portal/request-link"])(
    "does not mount retired human auth route %s",
    async (path) => {
      const headers = new Headers();
      if (path.startsWith("/api/v1/admin/")) {
        await seedEventAndAdmin(env.DB);
        const [staff] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
          "admin@pkic.org",
        ]);
        headers.set("authorization", `Bearer ${await createAdminSession(env.DB, staff.id, crypto.randomUUID())}`);
      }
      expect(
        await call(path, { method: "POST", body: JSON.stringify({ email: "admin@pkic.org" }), headers }),
      ).toMatchObject({ status: 404 });
    },
  );

  it("is enumeration-safe for unknown identities and rate-limits repeated requests", async () => {
    expect(await requestUserToken("unknown@example.test")).toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);

    await seedEventAndAdmin(env.DB);
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(2),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const request = () =>
      call(
        "/api/v1/auth/request-link",
        {
          method: "POST",
          body: JSON.stringify({ email: "admin@pkic.org" }),
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.10" },
        },
        limitedEnv,
      );
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(429);
  });

  it("enforces token purpose, verifier context, live eligibility, and one-time redemption", async () => {
    await seedDualCapacityUser();
    const token = await requestUserToken("admin@pkic.org", {
      "cf-connecting-ip": "203.0.113.9",
      "user-agent": "issuer",
    });
    expect(token).toMatch(/^pkc1_/);

    expect(
      await call("/api/v1/auth/verify-link", {
        method: "POST",
        body: JSON.stringify({ token: `${token}invalid` }),
      }),
    ).toMatchObject({ status: 404 });
    expect(
      await call("/api/v1/auth/verify-link", {
        method: "POST",
        body: JSON.stringify({ token }),
        headers: { "cf-connecting-ip": "203.0.113.10", "user-agent": "issuer" },
      }),
    ).toMatchObject({ status: 403 });

    const verified = await call("/api/v1/auth/verify-link", {
      method: "POST",
      body: JSON.stringify({ token }),
      headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "issuer" },
    });
    expect(verified.status).toBe(200);
    expect(
      await call("/api/v1/auth/verify-link", {
        method: "POST",
        body: JSON.stringify({ token }),
        headers: { "cf-connecting-ip": "203.0.113.9", "user-agent": "issuer" },
      }),
    ).toMatchObject({ status: 409 });
  });

  it("resolves staff-only and member-only identities, then revokes the sole canonical session", async () => {
    await seedEventAndAdmin(env.DB);
    const staffToken = await requestUserToken("admin@pkic.org");
    const staffResponse = await call("/api/v1/auth/verify-link", {
      method: "POST",
      body: JSON.stringify({ token: staffToken }),
    });
    expect(await staffResponse.clone().json()).toMatchObject({ staff: expect.any(Object) });
    expect(await staffResponse.clone().json()).not.toHaveProperty("member");

    await resetDb();
    await insertOrganization(env.DB, "Member-only organization");
    const { userId } = await insertIndividualMember(env.DB, "H5", "member-only@example.test");
    const memberToken = await requestUserToken("member-only@example.test");
    const memberResponse = await call("/api/v1/auth/verify-link", {
      method: "POST",
      body: JSON.stringify({ token: memberToken }),
    });
    expect(memberResponse.status).toBe(200);
    expect(await memberResponse.clone().json()).toMatchObject({ identity: { id: userId }, member: expect.any(Object) });
    expect(await memberResponse.clone().json()).not.toHaveProperty("staff");

    const cookie = cookiePair(memberResponse);
    expect((await call("/api/v1/auth/session", { headers: { cookie } })).status).toBe(200);
    expect((await call("/api/v1/auth/logout", { method: "POST", headers: { cookie } })).status).toBe(200);
    expect((await call("/api/v1/auth/session", { headers: { cookie } })).status).toBe(401);
    expect(await queryAll(env.DB, "SELECT id FROM sessions WHERE revoked_at IS NULL")).toHaveLength(0);
  });

  it("fails closed when a valid-shaped session loses every live capacity", async () => {
    await seedEventAndAdmin(env.DB);
    const [staff] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
      "admin@pkic.org",
    ]);
    const token = await createAdminSession(env.DB, staff.id, "inactive-capacity-session");
    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(staff.id).run();

    const response = await call("/api/v1/auth/session", { headers: { authorization: `Bearer ${token}` } });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_INVALID" } });
  });
});
