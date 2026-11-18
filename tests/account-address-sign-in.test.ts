/**
 * Which account addresses sign in once a representation ends, what the person
 * hears when one no longer does, and the security notices about address changes.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ENDING_LAST_SIGN_IN_METHOD_MESSAGE, LAST_SIGN_IN_METHOD } from "../assets/shared/auth-errors";
import { userAuthRequestSchema, userAuthVerifySchema } from "../assets/shared/schemas/user-auth";
import { queueUserSignInCapability } from "../functions/_lib/auth/user-session";
import { makeOwnEmailAddressPrimary, removeOwnEmailAddress } from "../functions/_lib/services/own-email-addresses";
import type { Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { createTestRateLimiter, deliveredEmailPayload, queryAll } from "./helpers/context";
import { insertOrganization, insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const WORK_EMAIL = "ana@acme.example";
let environment: Env;

async function workAccount(): Promise<{ userId: string; identityId: string; token: string }> {
  const userId = await insertUser(env.DB, WORK_EMAIL);
  const organizationId = await insertOrganization(env.DB, "Acme");
  const identityId = crypto.randomUUID();
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET email_verified_at = ?, email_verification_method = 'magic_link' WHERE id = ?",
    ).bind(at, userId),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, verified_email_domain, invited_at, started_at,
         created_at, updated_at)
       VALUES (?, ?, ?, 'verified_email', 'acme.example', ?, ?, ?, ?)`,
    ).bind(identityId, userId, organizationId, at, at, at, at),
  ]);
  const token = await createMemberSession(env.DB, userId, `work-${crypto.randomUUID()}`, undefined, identityId);
  return { userId, identityId, token };
}

async function addVerifiedAddress(userId: string, email: string): Promise<string> {
  const id = crypto.randomUUID();
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
     VALUES (?, ?, ?, ?, ?, 'magic_link', ?)`,
  )
    .bind(id, userId, email, email, at, at)
    .run();
  return id;
}

function signInLink(email: string) {
  return queueUserSignInCapability({
    db: env.DB,
    email,
    ttlMinutes: 10,
    signingSecret: environment.INTERNAL_SIGNING_SECRET!,
  });
}

async function requestLink(email: string): Promise<unknown> {
  const response = await callApi(environment, "/api/v1/auth/request-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(userAuthRequestSchema.parse({ email })),
  });
  expect(response.status).toBe(200);
  return response.json();
}

function endOwn(token: string, identityId: string): Promise<Response> {
  return callApi(environment, `/api/v1/users/current/identities/${identityId}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ transition: { state: "ended" } }),
  });
}

function outbox() {
  return queryAll<{ template_key: string; recipient_email: string }>(
    env.DB,
    "SELECT template_key, recipient_email FROM email_outbox ORDER BY rowid",
  );
}

describe("account addresses after a representation ends", () => {
  beforeEach(async () => {
    await resetDb();
    environment = { ...env, EMAIL_RATE_LIMITER: createTestRateLimiter(50), IP_RATE_LIMITER: createTestRateLimiter(50) };
  });

  it("retires a work primary when its representation ends, and keeps a personal address signing in", async () => {
    const { userId, identityId } = await workAccount();
    await addVerifiedAddress(userId, "ana@gmail.example");
    expect(await signInLink(WORK_EMAIL)).not.toBeNull();

    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(nowIso(), identityId).run();

    expect(await signInLink(WORK_EMAIL)).toBeNull();
    expect(await signInLink("ana@gmail.example")).toMatchObject({ identity: { id: userId } });
  });

  it("ends a session made through a work primary when its representation ends, and keeps one made otherwise", async () => {
    const { userId, identityId, token: otherSession } = await workAccount();
    await addVerifiedAddress(userId, "ana@gmail.example");
    await requestLink(WORK_EMAIL);
    const [link] = await queryAll<{ payload_json: string }>(
      env.DB,
      "SELECT payload_json FROM email_outbox WHERE template_key = 'user_magic_link'",
    );
    const payload = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, environment, link.payload_json);
    const verified = await callApi(environment, "/api/v1/auth/verify-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        userAuthVerifySchema.parse({
          token: new URLSearchParams(new URL(payload.magicLinkUrl).hash.split("?", 2)[1]).get("token"),
        }),
      ),
    });
    expect(verified.status).toBe(200);
    const cookie = verified.headers.get("set-cookie")!.split(";", 1)[0];
    const session = (headers: HeadersInit) => callApi(environment, "/api/v1/auth/session", { headers });
    expect((await session({ cookie })).status).toBe(200);

    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(nowIso(), identityId).run();

    expect((await session({ cookie })).status).toBe(401);
    expect((await session({ authorization: `Bearer ${otherSession}` })).status).toBe(200);
  });

  it("emails a retired address why it gets no link, with the same answer on screen as any address", async () => {
    const { userId, identityId } = await workAccount();
    await addVerifiedAddress(userId, "ana@gmail.example");
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(nowIso(), identityId).run();
    await env.DB.prepare(
      "INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), userId, "ana@unproved.example", "ana@unproved.example", nowIso())
      .run();

    const answers = [
      await requestLink(WORK_EMAIL),
      await requestLink("unknown@example.test"),
      await requestLink("ana@unproved.example"),
    ];

    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    // Only the retired mailbox hears of it; an unproved or unknown address gets nothing.
    expect(await outbox()).toEqual([{ template_key: "user_sign_in_unavailable", recipient_email: WORK_EMAIL }]);
  });

  it("keeps a primary retired after the organization removes the claim that covered it", async () => {
    const userId = await insertUser(env.DB, WORK_EMAIL);
    const organizationId = await insertOrganization(env.DB, "Acme");
    const identityId = crypto.randomUUID();
    const at = nowIso();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").bind(at, userId),
      env.DB.prepare(
        "INSERT INTO organization_domain_claims (id, domain, organization_id, created_at, updated_at) VALUES (?, 'acme.example', ?, ?, ?)",
      ).bind(crypto.randomUUID(), organizationId, at, at),
      // Backed by the organization's claim, not by a domain proved on the identity itself.
      env.DB.prepare(
        `INSERT INTO identities (id, user_id, organization_id, source, invited_at, started_at, created_at, updated_at)
         VALUES (?, ?, ?, 'verified_domain', ?, ?, ?, ?)`,
      ).bind(identityId, userId, organizationId, at, at, at, at),
    ]);
    await addVerifiedAddress(userId, "ana@gmail.example");
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(nowIso(), identityId).run();
    await env.DB.prepare("DELETE FROM organization_domain_claims WHERE organization_id = ?").bind(organizationId).run();

    expect(await signInLink(WORK_EMAIL)).toBeNull();
    expect(await signInLink("ana@gmail.example")).toMatchObject({ identity: { id: userId } });
  });

  it("ends, after the deploy, the open email sessions made through a primary that is now retired", async () => {
    const { userId, identityId } = await workAccount();
    await addVerifiedAddress(userId, "ana@gmail.example");
    const at = nowIso();
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    const session = (action: string) => {
      const id = crypto.randomUUID();
      return {
        id,
        statements: [
          env.DB.prepare(
            "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
          ).bind(id, userId, crypto.randomUUID(), expires, at),
          env.DB.prepare(
            `INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, created_at)
             VALUES (?, 'user', ?, ?, 'identity_session', ?, ?)`,
          ).bind(crypto.randomUUID(), userId, action, id, at),
        ],
      };
    };
    // Made before the deploy: no address marker on either.
    const byLink = session("user_magic_link_verified");
    const byPasskey = session("passkey_authenticated");
    await env.DB.batch([...byLink.statements, ...byPasskey.statements]);
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(nowIso(), identityId).run();

    const migration = env.TEST_MIGRATIONS.find((candidate) => candidate.name.startsWith("0049_"))!;
    const revoke = migration.queries.find((query) => query.includes("UPDATE sessions"))!;
    await env.DB.prepare(revoke).run();

    const revoked = await queryAll<{ id: string }>(env.DB, "SELECT id FROM sessions WHERE revoked_at IS NOT NULL");
    expect(revoked.map(({ id }) => id)).toEqual([byLink.id]);
  });

  it("refuses ending your own representation when it would leave no way to sign in", async () => {
    const { userId, identityId, token } = await workAccount();

    const refused = await endOwn(token, identityId);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: { code: LAST_SIGN_IN_METHOD, message: ENDING_LAST_SIGN_IN_METHOD_MESSAGE },
    });
    expect(await queryAll(env.DB, "SELECT ended_at FROM identities WHERE id = ?", identityId)).toEqual([
      { ended_at: null },
    ]);

    await addVerifiedAddress(userId, "ana@gmail.example");
    const ended = await endOwn(token, identityId);
    expect(ended.status, await ended.clone().text()).toBe(200);
  });
});

describe("security notices about account addresses", () => {
  beforeEach(async () => {
    await resetDb();
    environment = { ...env, EMAIL_RATE_LIMITER: createTestRateLimiter(50), IP_RATE_LIMITER: createTestRateLimiter(50) };
  });

  it("tells both mailboxes when an address becomes primary and when one is removed", async () => {
    const userId = await insertUser(env.DB, "lee@gmail.example");
    await env.DB.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?").bind(nowIso(), userId).run();
    const emailId = await addVerifiedAddress(userId, "lee@other.example");

    await makeOwnEmailAddressPrimary(env.DB, { userId, emailId });
    expect(await outbox()).toEqual([
      { template_key: "account_security_notice", recipient_email: "lee@other.example" },
      { template_key: "account_security_notice", recipient_email: "lee@gmail.example" },
    ]);

    await env.DB.prepare("DELETE FROM email_outbox").run();
    await removeOwnEmailAddress(env.DB, { userId, emailId });
    expect(await outbox()).toEqual([
      { template_key: "account_security_notice", recipient_email: "lee@gmail.example" },
      { template_key: "account_security_notice", recipient_email: "lee@other.example" },
    ]);
  });
});
