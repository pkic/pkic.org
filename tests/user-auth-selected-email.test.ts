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
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { setOwnEmailSignInPermission } from "../functions/_lib/services/own-email-sign-in";
import { insertUser, insertOrganization } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

const primaryEmail = "admin@pkic.org";
const aliasEmail = "verified-work@example.test";
let userId: string;
let aliasId: string;
let environment: Env;

async function addEmail(ownerId: string, email: string, verified = true, signInEnabled = true) {
  const id = crypto.randomUUID();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO user_emails
      (id,user_id,email,normalized_email,verified_at,verification_method,created_at)
     VALUES (?,?,?,?,?,?,?)`,
  )
    .bind(id, ownerId, email, email, verified ? now : null, verified ? "staff_verified" : null, now)
    .run();
  if (verified && signInEnabled)
    await setOwnEmailSignInPermission(env.DB, { userId: ownerId, emailId: id, enabled: true });
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
    await env.DB.prepare("UPDATE users SET email_verified_at=?,email_verification_method='magic_link' WHERE id=?")
      .bind(nowIso(), userId)
      .run();
    aliasId = await addEmail(userId, aliasEmail);
    environment = { ...env, EMAIL_RATE_LIMITER: createTestRateLimiter(50), IP_RATE_LIMITER: createTestRateLimiter(50) };
  });

  it("does not let an unverified primary claim unlock an account established through another mailbox", async () => {
    await env.DB.prepare("UPDATE users SET email_verified_at=NULL WHERE id=?").bind(userId).run();
    await requestLink(primaryEmail);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toEqual([]);
  });

  it("keeps a verified delivery-only address out of sign-in until the account owner explicitly enables it", async () => {
    const deliveryEmail = "archive-only@example.test";
    const deliveryAliasId = await addEmail(userId, deliveryEmail, true, false);
    await requestLink(deliveryEmail);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toEqual([]);
    const ownerSession = await createAdminSession(env.DB, userId, crypto.randomUUID());
    const otherUser = await insertUser(env.DB, "other@example.test");
    const otherSession = await createAdminSession(env.DB, otherUser, crypto.randomUUID());
    const patch = (token: string, body: unknown) =>
      callApi(environment, `/api/v1/users/current/emails/${deliveryAliasId}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await patch(otherSession, { signInEnabled: true })).status).toBe(404);
    expect((await patch(ownerSession, { signInEnabled: true, primary: true })).status).toBe(400);
    const enabled = await patch(ownerSession, { signInEnabled: true });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ email: { signInEnabled: true, primary: false } });
    await requestLink(deliveryEmail);
    expect((await latestDelivery()).recipient_email).toBe(deliveryEmail);
  });

  it("refuses permission changes for unverified addresses and rolls back lost proof races", async () => {
    const unverified = await addEmail(userId, "unproved@example.test", false);
    await expect(
      setOwnEmailSignInPermission(env.DB, { userId, emailId: unverified, enabled: true }),
    ).rejects.toMatchObject({ code: "EMAIL_SIGN_IN_INELIGIBLE" });
    await setOwnEmailSignInPermission(env.DB, { userId, emailId: aliasId, enabled: false });
    const auditBefore = await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='user_email_sign_in_changed'");
    const racing = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_emails SET verified_at=NULL WHERE id=?").bind(aliasId).run(),
    );
    await expect(
      setOwnEmailSignInPermission(racing, { userId, emailId: aliasId, enabled: true }),
    ).rejects.toMatchObject({ code: "EMAIL_SIGN_IN_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='user_email_sign_in_changed'")).toEqual(
      auditBefore,
    );
  });

  it("never resurrects an old sign-in link or session when address access is disabled and enabled again", async () => {
    await requestLink(aliasEmail);
    const delivery = await latestDelivery();
    const established = await verifyLink(delivery.token);
    expect(established.status).toBe(200);
    const cookie = established.headers.get("set-cookie")!.split(";", 1)[0];
    await requestLink(aliasEmail);
    const outstanding = await latestDelivery();
    const consent = await env.DB.prepare("SELECT enabled_at FROM user_email_sign_in_permissions WHERE email_id=?")
      .bind(aliasId)
      .first();
    await setOwnEmailSignInPermission(env.DB, { userId, emailId: aliasId, enabled: false });
    expect(
      await env.DB.prepare("SELECT enabled_at FROM user_email_sign_in_permissions WHERE email_id=?")
        .bind(aliasId)
        .first(),
    ).toEqual(consent);
    expect((await callApi(environment, "/api/v1/auth/session", { headers: { cookie } })).status).toBe(401);
    await setOwnEmailSignInPermission(env.DB, { userId, emailId: aliasId, enabled: true });
    expect((await verifyLink(outstanding.token)).status).toBe(404);
    expect((await callApi(environment, "/api/v1/auth/session", { headers: { cookie } })).status).toBe(401);
    await requestLink(aliasEmail);
    expect((await verifyLink((await latestDelivery()).token)).status).toBe(200);
  });

  it("does not queue a sign-in email when permission is revoked after the pre-read", async () => {
    const racing = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE user_email_sign_in_permissions SET revoked_at=? WHERE email_id=?")
        .bind(nowIso(), aliasId)
        .run(),
    );
    expect(
      await requestUserSignInLink(racing, {
        email: aliasEmail,
        ipHash: null,
        userAgentHash: null,
        ttlMinutes: 15,
        signingSecret: environment.INTERNAL_SIGNING_SECRET!,
        magicLinkBaseUrl: "https://app.test/portal/#/verify",
      }),
    ).toEqual({ outboxId: null, identityFound: false });
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='user_magic_link_requested'")).toEqual([]);
  });

  it.each(["removed", "proof_lost", "primary_swap", "disabled"] as const)(
    "revokes an established alias session when its address is %s",
    async (change) => {
      await requestLink(aliasEmail);
      const delivery = await latestDelivery();
      const response = await verifyLink(delivery.token);
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie")!.split(";", 1)[0];
      if (change === "removed") await env.DB.prepare("DELETE FROM user_emails WHERE id=?").bind(aliasId).run();
      if (change === "proof_lost")
        await env.DB.prepare("UPDATE user_emails SET verified_at=NULL WHERE id=?").bind(aliasId).run();
      if (change === "disabled") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(userId).run();
      if (change === "primary_swap") {
        const ownerSession = await createAdminSession(env.DB, userId, crypto.randomUUID());
        expect(
          (
            await callApi(environment, `/api/v1/users/current/emails/${aliasId}`, {
              method: "PATCH",
              headers: { authorization: `Bearer ${ownerSession}`, "content-type": "application/json" },
              body: JSON.stringify({ primary: true }),
            })
          ).status,
        ).toBe(200);
      }
      expect((await callApi(environment, "/api/v1/auth/session", { headers: { cookie } })).status).toBe(401);
      expect(await queryAll(env.DB, "SELECT revoked_at FROM sessions ORDER BY rowid LIMIT 1")).toEqual([
        { revoked_at: expect.any(String) },
      ]);
    },
  );

  it.each(["ended_at", "blocked_at"] as const)(
    "revokes only the owning representation's alias when its %s changes",
    async (column) => {
      const orgOne = await insertOrganization(env.DB, "First organization");
      const orgTwo = await insertOrganization(env.DB, "Second organization");
      const identityOne = crypto.randomUUID();
      const identityTwo = crypto.randomUUID();
      const at = nowIso();
      for (const [id, organization] of [
        [identityOne, orgOne],
        [identityTwo, orgTwo],
      ]) {
        await env.DB.prepare(`INSERT INTO identities (id,user_id,organization_id,source,invited_at,started_at,created_at,updated_at)
        VALUES (?,?,?,'staff',?,?,?,?)`)
          .bind(id, userId, organization, at, at, at, at)
          .run();
      }
      const secondEmail = "second-org@example.test";
      const secondAlias = await addEmail(userId, secondEmail, true, false);
      await env.DB.prepare("UPDATE user_emails SET identity_id=? WHERE id=?").bind(identityOne, aliasId).run();
      await env.DB.prepare("UPDATE user_emails SET identity_id=? WHERE id=?").bind(identityTwo, secondAlias).run();
      await setOwnEmailSignInPermission(env.DB, { userId, emailId: secondAlias, enabled: true });
      await requestLink(aliasEmail);
      const firstLink = await latestDelivery();
      const firstSession = await verifyLink(firstLink.token);
      expect(firstSession.status).toBe(200);
      const firstCookie = firstSession.headers.get("set-cookie")!.split(";", 1)[0];
      await requestLink(aliasEmail);
      const outstanding = await latestDelivery();
      const endedAt = nowIso();
      await env.DB.prepare(
        `UPDATE identities SET ended_at=?${column === "blocked_at" ? ", blocked_at=?" : ""} WHERE id=?`,
      )
        .bind(...(column === "blocked_at" ? [endedAt, endedAt, identityOne] : [endedAt, identityOne]))
        .run();
      expect((await verifyLink(outstanding.token)).status).toBe(404);
      expect((await callApi(environment, "/api/v1/auth/session", { headers: { cookie: firstCookie } })).status).toBe(
        401,
      );
      await expect(
        setOwnEmailSignInPermission(env.DB, { userId, emailId: aliasId, enabled: true }),
      ).rejects.toMatchObject({ code: "EMAIL_SIGN_IN_INELIGIBLE" });
      await requestLink(secondEmail);
      const secondDelivery = await latestDelivery();
      expect(secondDelivery.recipient_email).toBe(secondEmail);
      expect((await verifyLink(secondDelivery.token)).status).toBe(200);
      await requestLink(primaryEmail);
      expect((await verifyLink((await latestDelivery()).token)).status).toBe(200);
      expect(await queryAll(env.DB, "SELECT id FROM users")).toHaveLength(1);
    },
  );

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

  it("queues no delivery for an unverified alias, an unknown address or a disabled account's verified alias", async () => {
    const unverifiedEmail = "unverified-work@example.test";
    await addEmail(userId, unverifiedEmail, false);
    const otherId = await insertUser(env.DB, "other-primary@example.test");
    const otherAlias = "other-work@example.test";
    await addEmail(otherId, otherAlias);
    await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(otherId).run();
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
    "settles an already-delivered alias capability after its authority becomes %s",
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
      // Losing the last capacity leaves an active user, who may still sign in; the other changes remove the address or the user.
      expect(response.status).toBe(change === "capacity_revoked" ? 200 : 404);
      expect(await queryAll(env.DB, "SELECT id FROM sessions")).toHaveLength(change === "capacity_revoked" ? 1 : 0);
      expect(await queryAll(env.DB, "SELECT id FROM users")).toHaveLength(1);
    },
  );
});
