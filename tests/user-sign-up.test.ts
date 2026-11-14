import "../functions/http-router";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "./helpers/app";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { parseCapabilityToken } from "../functions/_lib/auth/capability-token";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";

async function call(path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env as never,
    { passThroughOnException() {}, waitUntil() {} } as any,
  );
}

async function lastLink(): Promise<URL | null> {
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox ORDER BY rowid DESC LIMIT 1",
  );
  if (!outbox) return null;
  const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
  return new URL(delivered.magicLinkUrl);
}

function linkToken(url: URL): string {
  return new URLSearchParams(url.hash.split("?", 2)[1]).get("token")!;
}

describe("account sign-up", () => {
  beforeEach(resetDb);

  it("proves a new address, creates the account with its individual identity, and returns to the flow", async () => {
    const returnPath = "/events/pqc-2027/register?invite=abc&id=1&source=invite";
    expect((await call("/api/v1/auth/sign-up", { email: "Ada@Organization.example", returnPath })).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", ["ada@organization.example"]),
    ).toHaveLength(0);

    const link = (await lastLink())!;
    expect(new URLSearchParams(link.hash.split("?", 2)[1]).get("next")).toBe(returnPath);
    const token = linkToken(link);
    expect(parseCapabilityToken(token, "user_sign_up")).not.toBeNull();

    const verified = await call("/api/v1/auth/verify-link", { token });
    expect(verified.status).toBe(200);
    const session = userAuthSessionResponseSchema.parse(await verified.json());
    expect(session.identity.email).toBe("ada@organization.example");
    expect(session.actingIdentities).toHaveLength(1);
    expect(verified.headers.get("set-cookie")).toBeTruthy();

    const [user] = await queryAll<{ id: string; email_verified_at: string | null }>(
      env.DB,
      "SELECT id, email_verified_at FROM users WHERE normalized_email = ?",
      ["ada@organization.example"],
    );
    expect(user.email_verified_at).toBeTruthy();
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE user_id = ? AND organization_id IS NULL", [user.id]),
    ).toHaveLength(1);

    expect((await call("/api/v1/auth/verify-link", { token })).status).toBe(409);
  });

  it("sends an address that already signs in an ordinary sign-in link", async () => {
    await seedEventAndAdmin(env.DB);
    expect((await call("/api/v1/auth/sign-up", { email: "admin@pkic.org" })).status).toBe(200);
    const token = linkToken((await lastLink())!);
    expect(parseCapabilityToken(token, "user_sign_in")).not.toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", ["admin@pkic.org"])).toHaveLength(
      1,
    );
  });

  it("holds the address to the shared work-email rule", async () => {
    expect((await call("/api/v1/auth/sign-up", { email: "ada@gmail.com" })).status).toBe(400);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
    expect((await call("/api/v1/auth/sign-up", { email: "ada@gmail.com", unaffiliatedAttestation: true })).status).toBe(
      200,
    );
    expect(parseCapabilityToken(linkToken((await lastLink())!), "user_sign_up")).not.toBeNull();
  });

  it("never signs in to an existing account through an address that account does not sign in with", async () => {
    await seedEventAndAdmin(env.DB);
    const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
      "admin@pkic.org",
    ]);
    // A verified secondary address with no sign-in permission.
    await env.DB.prepare(
      `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'magic_link', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
      .bind(crypto.randomUUID(), admin.id, "second@organization.example", "second@organization.example")
      .run();

    expect((await call("/api/v1/auth/sign-up", { email: "second@organization.example" })).status).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toHaveLength(0);
  });
});
