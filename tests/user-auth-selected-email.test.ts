import { grantAdministrator } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  userAuthEstablishedResponseSchema,
  userAuthRequestSchema,
  userAuthVerifySchema,
} from "../assets/shared/schemas/user-auth";
import { queueUserSignInCapability, verifyUserSessionToken } from "../functions/_lib/auth/user-session";
import { requestUserSignInLink } from "../functions/_lib/services/user-auth-flow";
import type { Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createTestRateLimiter, deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const primaryEmail = "admin@pkic.org";
const aliasEmail = "verified-work@example.test";
let userId: string;
let aliasId: string;
let environment: Env;

async function addEmail(ownerId: string, email: string, verified = true) {
  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO user_emails
      (id,user_id,email,normalized_email,verified_at,verification_method,created_at)
     VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(id, ownerId, email, email, verified ? now : null, verified ? "staff" : null, now)
    .run();
  return id;
}

async function requestLink(email: string) {
  const response = await callApi(environment, "/api/v1/auth/request-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(userAuthRequestSchema.parse({ email })),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true });
}

async function latestDelivery() {
  const [outbox] = await queryAll<{ recipient_email: string; recipient_user_id: string; payload_json: string }>(
    env.DB,
    "SELECT recipient_email,recipient_user_id,payload_json FROM email_outbox ORDER BY rowid DESC LIMIT 1",
  );
  expect(outbox).toBeDefined();
  const payload = await deliveredEmailPayload<{ email: string; magicLinkUrl: string }>(
    env.DB,
    environment,
    outbox.payload_json,
  );
  const token = new URLSearchParams(new URL(payload.magicLinkUrl).hash.split("?", 2)[1]).get("token");
  if (!token) throw new Error("Missing selected-address sign-in capability");
  return { ...outbox, payload, token };
}

async function verifyLink(token: string) {
  return callApi(environment, "/api/v1/auth/verify-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(userAuthVerifySchema.parse({ token })),
  });
}

describe("Selected sign-in email delivery", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    [userId] = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email=?", primaryEmail)).map(
      (user) => user.id,
    );
    aliasId = await addEmail(userId, aliasEmail);
    environment = { ...env, EMAIL_RATE_LIMITER: createTestRateLimiter(50), IP_RATE_LIMITER: createTestRateLimiter(50) };
  });

  it("keeps primary requests on the primary mailbox and the same canonical account", async () => {
    await requestLink(primaryEmail);
    const delivery = await latestDelivery();
    expect(delivery).toMatchObject({ recipient_email: primaryEmail, recipient_user_id: userId });
    expect(delivery.payload.email).toBe(primaryEmail);
    const response = await verifyLink(delivery.token);
    expect(response.status).toBe(200);
    expect(userAuthEstablishedResponseSchema.parse(await response.json()).identity).toEqual({
      id: userId,
      email: primaryEmail,
    });
  });

  it("delivers a normalized alias request to the resolved verified mailbox while retaining canonical identity and permissions", async () => {
    const queued = await queueUserSignInCapability({
      db: env.DB,
      email: aliasEmail.toUpperCase(),
      signingSecret: environment.INTERNAL_SIGNING_SECRET!,
      ttlMinutes: 15,
    });
    expect(queued).toMatchObject({ identity: { id: userId, email: primaryEmail }, recipientEmail: aliasEmail });
    await requestLink(aliasEmail.toUpperCase());
    const delivery = await latestDelivery();
    expect(delivery).toMatchObject({ recipient_email: aliasEmail, recipient_user_id: userId });
    expect(delivery.payload.email).toBe(aliasEmail);
    const response = await verifyLink(delivery.token);
    expect(response.status).toBe(200);
    const body = userAuthEstablishedResponseSchema.parse(await response.json());
    expect(body.identity).toEqual({ id: userId, email: primaryEmail });
    expect(body.staff).toBeDefined();
    expect(body.member).toBeUndefined();
    expect(body.sponsors).toEqual([]);
    const cookie = response.headers.get("set-cookie")!.split(";", 1)[0];
    const session = await verifyUserSessionToken(
      environment.INTERNAL_SIGNING_SECRET!,
      cookie.slice("pkic_session=".length),
    );
    expect(session.ok && session.claims).toMatchObject({ sub: userId, sid: body.sessionId });
    expect(await queryAll(env.DB, "SELECT id FROM users")).toHaveLength(1);
    expect(await queryAll(env.DB, "SELECT user_id FROM sessions")).toEqual([{ user_id: userId }]);
  });

  it("queues no delivery for an unverified alias, unknown address or another ineligible account's verified alias", async () => {
    const unverifiedEmail = "unverified-work@example.test";
    await addEmail(userId, unverifiedEmail, false);
    const otherId = await insertUser(env.DB, "other-primary@example.test");
    const otherAlias = "other-work@example.test";
    await addEmail(otherId, otherAlias);
    for (const email of [unverifiedEmail, "unknown@example.test", otherAlias]) await requestLink(email);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM users")).toHaveLength(2);
  });

  it("resolves another eligible account's verified alias exclusively to its actual owner", async () => {
    const otherPrimary = "other-primary@example.test";
    const otherAlias = "other-work@example.test";
    const otherId = await insertUser(env.DB, otherPrimary);
    await grantAdministrator(env.DB, otherId);
    await addEmail(otherId, otherAlias);
    await requestLink(otherAlias);
    const delivery = await latestDelivery();
    expect(delivery).toMatchObject({ recipient_email: otherAlias, recipient_user_id: otherId });
    const response = await verifyLink(delivery.token);
    expect(response.status).toBe(200);
    expect(userAuthEstablishedResponseSchema.parse(await response.json()).identity).toEqual({
      id: otherId,
      email: otherPrimary,
    });
    expect(await queryAll(env.DB, "SELECT user_id FROM sessions")).toEqual([{ user_id: otherId }]);
  });

  it.each(["unverified", "removed", "disabled", "capacity_revoked"] as const)(
    "refuses an already-delivered alias capability after its authority becomes %s",
    async (change) => {
      const request = await requestUserSignInLink(env.DB, {
        email: aliasEmail,
        ipHash: null,
        userAgentHash: null,
        ttlMinutes: 15,
        signingSecret: environment.INTERNAL_SIGNING_SECRET!,
        magicLinkBaseUrl: "https://app.test/portal/#/verify",
      });
      expect(request.outboxId).not.toBeNull();
      const delivery = await latestDelivery();
      expect(delivery.recipient_email).toBe(aliasEmail);
      if (change === "unverified")
        await env.DB.prepare("UPDATE user_emails SET verified_at=NULL WHERE id=?").bind(aliasId).run();
      else if (change === "removed") await env.DB.prepare("DELETE FROM user_emails WHERE id=?").bind(aliasId).run();
      else if (change === "disabled") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(userId).run();
      else
        await env.DB.prepare(
          `UPDATE user_roles SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
            WHERE user_id=? AND role_id='role-admin'
              AND context_type IS NULL AND context_id IS NULL AND revoked_at IS NULL`,
        )
          .bind(userId)
          .run();
      const response = await verifyLink(delivery.token);
      expect(response.status).toBe(change === "capacity_revoked" ? 403 : 404);
      expect(await queryAll(env.DB, "SELECT id FROM sessions")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM users")).toHaveLength(1);
    },
  );
});
