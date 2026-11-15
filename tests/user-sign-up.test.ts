import "../functions/http-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "./helpers/app";
import { deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { parseCapabilityToken } from "../functions/_lib/auth/capability-token";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { prepareAccountIdentityStatement } from "../functions/_lib/services/users";
import { createMemberSession } from "./helpers/auth";
import { insertUser } from "./helpers/membership";

/** Background work a request starts (outbox delivery); awaited so it never runs into the next test. */
const background: Promise<unknown>[] = [];

async function call(path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env as never,
    {
      passThroughOnException() {},
      waitUntil(work: Promise<unknown>) {
        background.push(work);
      },
    } as any,
  );
}

async function storedPayload(): Promise<string> {
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox ORDER BY rowid DESC LIMIT 1",
  );
  return outbox!.payload_json;
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
  afterEach(async () => {
    await Promise.allSettled(background.splice(0));
  });

  it("proves a new address, creates the account with its individual identity, and returns to the flow", async () => {
    const returnPath = "/events/pqc-2027/register?id=1&source=invite";
    expect((await call("/api/v1/auth/sign-up", { email: "Ada@Organization.example", returnPath })).status).toBe(200);
    expect(
      await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", ["ada@organization.example"]),
    ).toHaveLength(0);

    const link = (await lastLink())!;
    expect(new URLSearchParams(link.hash.split("?", 2)[1]).get("next")).toBe(returnPath);
    const token = linkToken(link);
    expect(parseCapabilityToken(token, "user_sign_up")).not.toBeNull();
    // The outbox holds only a queued marker, never the usable token.
    const stored = await storedPayload();
    expect(stored).not.toContain(token);
    expect(stored).toContain("pkcq1_");
    expect(JSON.parse(stored).__authorizedCapabilityMarkers).toHaveLength(1);

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

  it("refuses a return path that carries an invitation token, so no token reaches the outbox", async () => {
    await seedEventAndAdmin(env.DB);
    const returnPath = "/events/pqc-2027/register?invite=secret-invitation-token&id=1";
    for (const [path, email] of [
      ["/api/v1/auth/sign-up", "ada@organization.example"],
      ["/api/v1/auth/request-link", "admin@pkic.org"],
    ] as const)
      expect((await call(path, { email, returnPath })).status, path).toBe(400);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });

  it("claims an unverified alias for a new account without adopting the account that added it", async () => {
    const email = "casey.claimed@organization.example";
    const other = await insertUser(env.DB, "other@other.example");
    await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), other, email, email, new Date().toISOString())
      .run();
    expect((await call("/api/v1/auth/sign-up", { email })).status).toBe(200);
    const verified = await call("/api/v1/auth/verify-link", { token: linkToken((await lastLink())!) });
    expect(verified.status, await verified.clone().text()).toBe(200);

    const [owner] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email=?", [email]);
    expect(owner.id).not.toBe(other);
    expect(
      await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id=? AND normalized_email=?", [other, email]),
    ).toEqual([]);
  });

  it("recovers an unverified account without inheriting its passkey or browser session", async () => {
    const email = "casey.unverified@organization.example";
    const userId = await insertUser(env.DB, email);
    const at = new Date().toISOString();
    await env.DB.batch([
      prepareAccountIdentityStatement(env.DB, userId, at),
      env.DB.prepare(
        "INSERT INTO passkey_credentials(id,user_id,credential_id,public_key,created_at) VALUES(?,?,?,?,?)",
      ).bind(crypto.randomUUID(), userId, "untrusted-old-passkey", "untrusted-key", at),
    ]);
    await createMemberSession(env.DB, userId, "untrusted-old-session");
    expect((await call("/api/v1/auth/sign-up", { email })).status).toBe(200);
    const verified = await call("/api/v1/auth/verify-link", { token: linkToken((await lastLink())!) });
    expect(verified.status, await verified.clone().text()).toBe(200);

    expect(
      await queryAll(env.DB, "SELECT id FROM passkey_credentials WHERE user_id=? AND revoked_at IS NULL", [userId]),
    ).toEqual([]);
    const sessions = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM sessions WHERE user_id=? AND revoked_at IS NULL",
      [userId],
    );
    expect(sessions.map(({ id }) => id)).not.toContain("untrusted-old-session");
  });

  it("refuses the link when another account proves the address after it was sent", async () => {
    const email = "casey.raced@organization.example";
    expect((await call("/api/v1/auth/sign-up", { email })).status).toBe(200);
    const token = linkToken((await lastLink())!);
    const other = await insertUser(env.DB, "racer@other.example");
    const at = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,verification_method,created_at) VALUES(?,?,?,?,?,'magic_link',?)",
    )
      .bind(crypto.randomUUID(), other, email, email, at, at)
      .run();

    expect((await call("/api/v1/auth/verify-link", { token })).status).toBe(404);
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email=?", [email])).toEqual([]);
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
