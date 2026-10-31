/**
 * A signed-in person manages their own email addresses: add one, prove it
 * through the emailed link, make a verified one primary, and remove one no
 * organization identity uses. A verified work address joins the organization
 * its domain belongs to through the shared rule.
 */
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { affiliationOfferResponseSchema } from "../assets/shared/schemas/affiliation-offer";
import {
  EMAIL_VERIFIED_ELSEWHERE,
  OWN_EMAIL_ALREADY_ON_ACCOUNT,
  OWN_EMAIL_ALREADY_ON_ACCOUNT_MESSAGES,
  ownEmailInUseMessage,
  ownEmailAddressAddSchema,
  ownEmailVerificationRequestedResponseSchema,
  ownEmailVerificationSentResponseSchema,
  ownEmailAddressResponseSchema,
  ownEmailAddressUpdateSchema,
  ownEmailAddressVerificationPreviewResponseSchema,
  ownEmailAddressVerificationResponseSchema,
  ownEmailAddressVerificationSchema,
  ownEmailAddressesListResponseSchema,
} from "../assets/shared/schemas/own-email-addresses";
import type { Env } from "../functions/_lib/types";
import { LAST_SIGN_IN_METHOD, LAST_SIGN_IN_METHOD_MESSAGE } from "../assets/shared/auth-errors";
import { activateTemplateVersion, createTemplateVersion } from "../functions/_lib/email/templates";
import { findOrCreateUser } from "../functions/_lib/services/users";
import { createRegistration, changeRegistrationEmail } from "../functions/_lib/services/registrations";
import { getRegistrationByManageToken } from "../functions/_lib/services/registrations/queries";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { createTestRateLimiter, deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { resetDb } from "./helpers/reset-db";

let environment: Env;
let tokenCounter = 0;
const accountTokens = new Map<string, string>();
const linkAccounts = new Map<string, string>();

async function signedIn(email: string): Promise<{ userId: string; token: string }> {
  const userId = await insertUser(env.DB, email);
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET email_verified_at = ?, email_verification_method = 'magic_link' WHERE id = ?",
    ).bind(at, userId),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, show_on_organization_profile, invited_at,
         started_at, created_at, updated_at)
       VALUES (?, ?, NULL, 'account', 0, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), userId, at, at, at, at),
  ]);
  tokenCounter += 1;
  const token = await createMemberSession(env.DB, userId, `own-email-token-${tokenCounter}`);
  accountTokens.set(userId, token);
  return { userId, token };
}

async function claimDomain(organizationId: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO organization_domain_claims (id, domain, organization_id, application_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  )
    .bind(crypto.randomUUID(), domain, organizationId, nowIso(), nowIso())
    .run();
}

function call(token: string, path: string, method = "GET", body?: unknown): Promise<Response> {
  return callApi(environment, `/api/v1/users/current/emails${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function add(token: string, email: string) {
  const response = await call(token, "", "POST", ownEmailAddressAddSchema.parse({ email }));
  expect(response.status, await response.clone().text()).toBe(202);
  const requested = ownEmailVerificationRequestedResponseSchema.parse(await response.json());
  return { id: requested.requestId, email: requested.email };
}

/** The verification link the outbox would deliver to `email`, as the token the page sends back. */
async function verificationToken(email: string): Promise<string> {
  const [outbox] = await queryAll<{ payload_json: string; recipient_user_id: string }>(
    env.DB,
    `SELECT payload_json,recipient_user_id FROM email_outbox WHERE template_key = 'user_email_verification' AND recipient_email = ?
      ORDER BY rowid DESC LIMIT 1`,
    [email],
  );
  expect(outbox).toBeDefined();
  const payload = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, environment, outbox!.payload_json);
  const token = new URLSearchParams(new URL(payload.verificationUrl).hash.split("?", 2)[1]).get("token");
  if (!token) throw new Error("Missing verification capability");
  linkAccounts.set(token, accountTokens.get(outbox.recipient_user_id)!);
  return token;
}

/** The page a link opens calls these without any session: the link alone proves the mailbox. */
function publicLinkCall(path: string, linkToken: string): Promise<Response> {
  return callApi(environment, `/api/v1/auth/email-verifications${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(path === ""
        ? { authorization: `Bearer ${linkAccounts.get(linkToken) ?? [...accountTokens.values()].at(-1)}` }
        : {}),
    },
    body: JSON.stringify(ownEmailAddressVerificationSchema.parse({ token: linkToken })),
  });
}

async function verify(linkToken: string): Promise<Response> {
  return publicLinkCall("", linkToken);
}

describe("a person's own email addresses", () => {
  beforeEach(async () => {
    await resetDb();
    environment = { ...env, EMAIL_RATE_LIMITER: createTestRateLimiter(50), IP_RATE_LIMITER: createTestRateLimiter(50) };
  });

  it("explicitly consolidates a proved unverified primary into the current account without importing access", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const source = await findOrCreateUser(env.DB, {
      email: "unverified@consolidation.example",
      firstName: "Untrusted",
    });
    const originalSession = await createMemberSession(env.DB, source.id, "unverified-consolidation-session");
    const account = await signedIn("current@consolidation.example");
    const originalName = await env.DB.prepare("SELECT first_name FROM users WHERE id=?")
      .bind(account.userId)
      .first("first_name");
    const at = nowIso();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO passkey_credentials(id,user_id,credential_id,public_key,created_at) VALUES(?,?,?,?,?)",
      ).bind(crypto.randomUUID(), source.id, "pre-proof-key", "untrusted-public-key", at),
      env.DB.prepare(
        "INSERT INTO permission_grants(id,user_id,permission,created_at) VALUES(?,?,'users:write',?)",
      ).bind(crypto.randomUUID(), source.id, at),
      env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)").bind(
        crypto.randomUUID(),
        source.id,
        "unproved@elsewhere.example",
        "unproved@elsewhere.example",
        at,
      ),
      env.DB.prepare(`INSERT INTO oauth_authorizations(id,user_id,session_id,client_id,client_name,status,expires_at,created_at,updated_at)
        SELECT ?,user_id,id,'untrusted-client','Untrusted client','approved',?,?,? FROM sessions WHERE user_id=?`).bind(
        crypto.randomUUID(),
        "2099-01-01T00:00:00.000Z",
        at,
        at,
        source.id,
      ),
    ]);
    const registration = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: source.id,
      attendanceType: "virtual",
      sourceType: "web",
      confirmationTtlHours: 24,
      signingSecret: environment.INTERNAL_SIGNING_SECRET!,
    });
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO agenda_calendar_subscriptions(id,event_id,user_id,token_hash,created_at) VALUES(?,?,?,?,?)",
      ).bind(crypto.randomUUID(), eventId, source.id, "pre-proof-calendar", at),
      env.DB.prepare(
        "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at) VALUES(?,?,?,?,?)",
      ).bind(crypto.randomUUID(), eventId, source.id, "pre-proof-badge", at),
      env.DB.prepare(`INSERT INTO oauth_authorization_completions(authorization_id,status,request_ciphertext,attempt_until,next_attempt_at,created_at,updated_at)
        SELECT id,'queued','untrusted-pending-request','2099-01-01T00:00:00.000Z',?,?,? FROM oauth_authorizations WHERE user_id=?`).bind(
        at,
        at,
        at,
        source.id,
      ),
    ]);
    const ownRegistration = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: account.userId,
      attendanceType: "virtual",
      sourceType: "web",
      confirmationTtlHours: 24,
      signingSecret: environment.INTERNAL_SIGNING_SECRET!,
    });
    const proposalId = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO session_proposals(id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at)
      VALUES(?,?,?,'submitted','talk','Historical proposal','Abstract','old-proposal-secret',?,?)`)
      .bind(proposalId, eventId, source.id, at, at)
      .run();
    const added = await add(account.token, source.email);
    const link = await verificationToken(added.email);
    const preview = await publicLinkCall("/preview", link);
    expect(
      ownEmailAddressVerificationPreviewResponseSchema.parse(await preview.json()).consolidatesUnverifiedAccount,
    ).toBe(true);
    expect((await verify(link)).status).toBe(409);
    const confirmed = await callApi(environment, "/api/v1/auth/email-verifications", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
      body: JSON.stringify(
        ownEmailAddressVerificationSchema.parse({ token: link, consolidateUnverifiedAccount: true }),
      ),
    });
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT active FROM users WHERE id=?", [source.id])).toEqual([{ active: 0 }]);
    expect(
      await queryAll(env.DB, "SELECT user_id FROM user_emails WHERE id=? AND verified_at IS NOT NULL", [added.id]),
    ).toEqual([{ user_id: account.userId }]);
    expect(
      await env.DB.prepare("SELECT manage_link_secret FROM session_proposals WHERE id=?")
        .bind(proposalId)
        .first("manage_link_secret"),
    ).not.toBe("old-proposal-secret");
    expect((await call(originalSession, "")).status).toBe(401);
    expect((await call(account.token, "")).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT first_name FROM users WHERE id=?").bind(account.userId).first("first_name"),
    ).toBe(originalName);
    expect(
      await queryAll(env.DB, "SELECT id FROM agenda_calendar_subscriptions WHERE user_id=? AND revoked_at IS NULL", [
        source.id,
      ]),
    ).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM event_badge_credentials WHERE user_id=? AND revoked_at IS NULL", [
        source.id,
      ]),
    ).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        "SELECT authorization_id FROM oauth_authorization_completions WHERE status<>'failed' OR request_ciphertext IS NOT NULL",
      ),
    ).toEqual([]);
    expect(
      await env.DB.prepare("SELECT user_id FROM registrations WHERE id=?")
        .bind(ownRegistration.registration.id)
        .first("user_id"),
    ).toBe(account.userId);

    expect(
      await queryAll(env.DB, "SELECT id FROM passkey_credentials WHERE user_id=? AND revoked_at IS NULL", [source.id]),
    ).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM oauth_authorizations WHERE user_id=? AND status<>'revoked'", [source.id]),
    ).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT id FROM permission_grants WHERE user_id IN(?,?) AND revoked_at IS NULL", [
        source.id,
        account.userId,
      ]),
    ).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM user_emails WHERE user_id=? AND normalized_email='unproved@elsewhere.example'",
        [account.userId],
      ),
    ).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT user_id FROM registrations WHERE id=?", [registration.registration.id]),
    ).toEqual([{ user_id: source.id }]);
    await expect(
      getRegistrationByManageToken(env.DB, registration.manageToken, environment.INTERNAL_SIGNING_SECRET!),
    ).rejects.toThrow();
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=? AND ended_at IS NULL", [source.id]),
    ).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT entity_id,actor_id FROM audit_log WHERE action='unverified_account_consolidated'"),
    ).toEqual([{ entity_id: source.id, actor_id: account.userId }]);
    expect((await verify(link)).status).toBe(409);
  });

  it("refuses an address verified on another account with a specific next step, even with consolidation consent", async () => {
    const source = await signedIn("verified@consolidation.example");
    const account = await signedIn("current@consolidation.example");
    await add(account.token, "verified@consolidation.example");
    const link = await verificationToken("verified@consolidation.example");
    const refused = await callApi(environment, "/api/v1/auth/email-verifications", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
      body: JSON.stringify(
        ownEmailAddressVerificationSchema.parse({ token: link, consolidateUnverifiedAccount: true }),
      ),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: EMAIL_VERIFIED_ELSEWHERE });
    // The page the link opens says so before anything is confirmed, and names neither account.
    const preview = await publicLinkCall("/preview", link);
    expect(preview.status).toBe(409);
    const previewBody = JSON.stringify(await preview.json());
    expect(previewBody).toContain(EMAIL_VERIFIED_ELSEWHERE.code);
    expect(previewBody).not.toContain(source.userId);
    expect((await call(source.token, "")).status).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='unverified_account_consolidated'")).toEqual(
      [],
    );
  });

  it("releases an unverified primary without consolidating an account established by another mailbox", async () => {
    const source = await findOrCreateUser(env.DB, { email: "unproved@consolidation.example" });
    const account = await signedIn("current@consolidation.example");
    await env.DB.prepare(
      "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        crypto.randomUUID(),
        source.id,
        "established@elsewhere.example",
        "established@elsewhere.example",
        nowIso(),
        nowIso(),
      )
      .run();
    const added = await add(account.token, source.email);
    const link = await verificationToken(added.email);
    expect((await verify(link)).status).toBe(200);
    expect(await env.DB.prepare("SELECT email FROM users WHERE id=? AND active=1").bind(source.id).first("email")).toBe(
      "established@elsewhere.example",
    );
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='unverified_account_consolidated'")).toEqual(
      [],
    );
  });

  it.each(["primary proof", "secondary proof", "revoked session", "retired source"])(
    "rolls back consolidation after a concurrent %s",
    async (change) => {
      const source = await findOrCreateUser(env.DB, { email: "concurrent@consolidation.example" });
      const account = await signedIn("current@consolidation.example");
      const added = await add(account.token, source.email);
      const link = await verificationToken(added.email);
      const gate = gateNextBatch(env.DB);
      const attempt = callApi({ ...environment, DB: gate.db as typeof env.DB }, "/api/v1/auth/email-verifications", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${account.token}` },
        body: JSON.stringify(
          ownEmailAddressVerificationSchema.parse({ token: link, consolidateUnverifiedAccount: true }),
        ),
      });
      await gate.reached;
      try {
        if (change === "primary proof")
          await env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?").bind(nowIso(), source.id).run();
        if (change === "secondary proof")
          await env.DB.prepare(
            "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at) VALUES(?,?,?,?,?,?)",
          )
            .bind(
              crypto.randomUUID(),
              source.id,
              "proved@elsewhere.example",
              "proved@elsewhere.example",
              nowIso(),
              nowIso(),
            )
            .run();
        if (change === "revoked session")
          await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), account.userId).run();
        if (change === "retired source")
          await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(source.id).run();
      } finally {
        gate.release();
      }
      expect((await attempt).status).toBe(404);
      expect(
        await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id=? AND normalized_email=?", [
          account.userId,
          source.email,
        ]),
      ).toEqual([]);
      expect(
        await queryAll(
          env.DB,
          "SELECT id FROM audit_log WHERE action IN('unverified_account_consolidated','user_email_verified')",
        ),
      ).toEqual([]);
      expect(await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(source.id).first("email")).toBe(
        source.email,
      );
    },
  );

  it("resends without persisting requests and spends each proof only once", async () => {
    const account = await signedIn("repeat@owner.example");
    await add(account.token, "repeat@work.example");
    const first = await verificationToken("repeat@work.example");
    await add(account.token, "repeat@work.example");
    const second = await verificationToken("repeat@work.example");
    expect(await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id=?", [account.userId])).toEqual([]);
    expect((await verify(first)).status).toBe(200);
    expect((await verify(first)).status).toBe(409);
    expect((await verify(second)).status).toBe(409);
  });

  it("checks address capacity again when proof is redeemed", async () => {
    const account = await signedIn("capacity@owner.example");
    await add(account.token, "capacity@work.example");
    const link = await verificationToken("capacity@work.example");
    await env.DB.batch(
      Array.from({ length: 10 }, (_, index) =>
        env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)").bind(
          crypto.randomUUID(),
          account.userId,
          `saved-${index}@elsewhere.example`,
          `saved-${index}@elsewhere.example`,
          nowIso(),
        ),
      ),
    );
    expect((await verify(link)).status).toBe(404);
    expect(await queryAll(env.DB, "SELECT id FROM user_emails WHERE normalized_email='capacity@work.example'")).toEqual(
      [],
    );
  });

  it("resends and verifies an existing unverified address without creating another row", async () => {
    const account = await signedIn("legacy@owner.example");
    const id = crypto.randomUUID(),
      email = "legacy@work.example";
    await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)")
      .bind(id, account.userId, email, email, nowIso())
      .run();
    expect((await call(account.token, `/${id}/verification`, "POST")).status).toBe(202);
    const link = await verificationToken(email);
    expect((await publicLinkCall("/preview", link)).status).toBe(200);
    expect((await verify(link)).status).toBe(200);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM user_emails WHERE user_id=? AND normalized_email=? AND verified_at IS NOT NULL",
        [account.userId, email],
      ),
    ).toEqual([{ id }]);
  });

  it("does not attach a mailbox to another account when its owner opens that account's verification link", async () => {
    const attacker = await signedIn("attacker@elsewhere.example");
    const victim = await signedIn("victim@owner.example");
    const added = await add(attacker.token, "victim@work.example");
    const link = await verificationToken(added.email);
    const response = await callApi(environment, "/api/v1/auth/email-verifications", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${victim.token}` },
      body: JSON.stringify(ownEmailAddressVerificationSchema.parse({ token: link })),
    });
    expect(response.status).toBe(403);
    expect(await queryAll(env.DB, "SELECT verified_at FROM user_emails WHERE id=?", [added.id])).toEqual([]);
  });

  it("invalidates an old correction confirmation before releasing its pending address", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const bootstrap = await findOrCreateUser(env.DB, { email: "victim@original.example" });
    const signingSecret = environment.INTERNAL_SIGNING_SECRET!;
    const created = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: bootstrap.id,
      attendanceType: "virtual",
      sourceType: "web",
      confirmationTtlHours: 24,
      signingSecret,
    });
    const change = await changeRegistrationEmail(env.DB, {
      registrationId: created.registration.id,
      newEmail: "proof@added.example",
      authority: { kind: "event_manager", actorUserId: bootstrap.id },
      confirmationTtlHours: 24,
      signingSecret,
    });
    const owner = await signedIn("owner@established.example");
    await add(owner.token, "proof@added.example");
    expect((await verify(await verificationToken("proof@added.example"))).status).toBe(200);
    const oldConfirmation = await callApi(environment, "/api/v1/events/pqc-2026/registrations/confirm-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: change.confirmationToken }),
    });
    expect(oldConfirmation.status).toBe(404);
    expect(await queryAll(env.DB, "SELECT email_verified_at FROM users WHERE id=?", [bootstrap.id])).toEqual([
      { email_verified_at: null },
    ]);
  });

  it("does not preserve an unverified creator's manage link after the mailbox owner confirms", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const bootstrap = await findOrCreateUser(env.DB, { email: "victim@confirmation.example" });
    const signingSecret = environment.INTERNAL_SIGNING_SECRET!;
    const created = await createRegistration(env.DB, {
      event: { id: eventId },
      userId: bootstrap.id,
      attendanceType: "virtual",
      sourceType: "web",
      confirmationTtlHours: 24,
      signingSecret,
    });
    await getRegistrationByManageToken(env.DB, created.manageToken, signingSecret);
    const confirmed = await callApi(environment, "/api/v1/events/pqc-2026/registrations/confirm-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: created.confirmationToken }),
    });
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
    await expect(getRegistrationByManageToken(env.DB, created.manageToken, signingSecret)).rejects.toThrow();
  });

  it("allows competing pending requests but only one proved ownership transition", async () => {
    const first = await signedIn("first@owner.example");
    const second = await signedIn("second@owner.example");
    const email = "same@work.example";
    await add(first.token, email);
    const firstLink = await verificationToken(email);
    await add(second.token, email);
    const secondLink = await verificationToken(email);
    expect(await queryAll(env.DB, "SELECT id FROM user_emails WHERE normalized_email=?", [email])).toEqual([]);
    expect((await verify(firstLink)).status).toBe(200);
    // The second claimant proved the mailbox too, so it learns why and what to do, but not whose account holds it.
    const refused = await verify(secondLink);
    expect(refused.status).toBe(409);
    const refusal = await refused.json();
    expect(refusal).toMatchObject({ error: EMAIL_VERIFIED_ELSEWHERE });
    expect(JSON.stringify(refusal)).not.toContain("first@owner.example");
    expect(await queryAll(env.DB, "SELECT user_id FROM user_emails WHERE normalized_email=?", [email])).toEqual([
      { user_id: first.userId },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [second.userId])).toHaveLength(1);
  });

  it("verifies a representation address without creating its organization association before explicit confirmation", async () => {
    const organizationId = await insertOrganization(env.DB, "Shared Work Domain Owner");
    await claimDomain(organizationId, "representation-work.example");
    const { userId, token } = await signedIn("ana@gmail.com");
    const requested = await call(
      token,
      "",
      "POST",
      ownEmailAddressAddSchema.parse({
        email: "ana@representation-work.example",
        purpose: "representation",
        unaffiliatedAttestation: false,
      }),
    );
    expect(requested.status, await requested.clone().text()).toBe(202);
    const link = await verificationToken("ana@representation-work.example");
    const response = await verify(link);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(ownEmailAddressVerificationResponseSchema.parse(await response.json())).toEqual({
      email: "ana@representation-work.example",
      joinedOrganization: null,
      offeredOrganization: null,
    });
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=? AND organization_id IS NOT NULL", [userId]),
    ).toEqual([]);
    expect(
      await queryAll(
        env.DB,
        "SELECT identity_id,verified_at IS NOT NULL AS verified FROM user_emails WHERE user_id=?",
        [userId],
      ),
    ).toEqual([{ identity_id: null, verified: 1 }]);
  });

  it("adds an address, verifies it through the emailed link once, and joins the organization its domain belongs to", async () => {
    const organizationId = await insertOrganization(env.DB, "Open Claimed Co");
    await claimDomain(organizationId, "open-claimed.example");
    const { userId, token } = await signedIn("ana@gmail.com");

    const added = await add(token, "ana@open-claimed.example");
    expect(added.email).toBe("ana@open-claimed.example");
    const beforeProof = ownEmailAddressesListResponseSchema.parse(await (await call(token, "")).json());
    expect(beforeProof.emails.map((entry) => entry.email)).toEqual(["ana@gmail.com"]);

    const link = await verificationToken("ana@open-claimed.example");
    const preview = await publicLinkCall("/preview", link);
    expect(ownEmailAddressVerificationPreviewResponseSchema.parse(await preview.json())).toEqual({
      accountEmail: "ana@gmail.com",
      consolidatesUnverifiedAccount: false,
      email: "ana@open-claimed.example",
    });
    // Previewing changes nothing; linking requires the intended session.
    const verified = await verify(link);
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(ownEmailAddressVerificationResponseSchema.parse(await verified.json())).toEqual({
      email: "ana@open-claimed.example",
      joinedOrganization: { id: organizationId, name: "Open Claimed Co" },
      offeredOrganization: null,
    });
    // The work address belongs to the identity it established.
    expect(
      await queryAll(env.DB, "SELECT identity_id IS NOT NULL AS owned FROM user_emails WHERE id = ?", [added.id]),
    ).toEqual([{ owned: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT organization_id, email_id, source FROM identities WHERE user_id = ? AND organization_id IS NOT NULL",
        [userId],
      ),
    ).toEqual([{ organization_id: organizationId, email_id: added.id, source: "verified_domain" }]);

    const replay = await verify(link);
    expect(replay.status).toBe(409);

    const listed = await call(token, "?sort=email");
    expect(ownEmailAddressesListResponseSchema.parse(await listed.json()).emails.map((email) => email.email)).toEqual([
      "ana@gmail.com",
      "ana@open-claimed.example",
    ]);
  });

  it.each(["identity", "notification"])(
    "rolls back verification when the %s write fails and lets the same link retry",
    async (failure) => {
      const organizationId = await insertOrganization(env.DB, "Retry Claimed Co");
      await claimDomain(organizationId, "retry-claimed.example");
      const { userId, token } = await signedIn("retry@gmail.com");
      const added = await add(token, "retry@retry-claimed.example");
      const link = await verificationToken(added.email);
      const target =
        failure === "identity"
          ? "identities WHEN NEW.organization_id IS NOT NULL"
          : "email_outbox WHEN NEW.template_key = 'organization-identity-changed'";
      await env.DB.prepare(`CREATE TRIGGER fail_verification_link BEFORE INSERT ON ${target}
        BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_VERIFICATION_LINK_FAILURE'); END`).run();
      try {
        expect((await verify(link)).status).toBe(500);
        expect(
          await queryAll(env.DB, "SELECT verified_at, verification_method, identity_id FROM user_emails WHERE id = ?", [
            added.id,
          ]),
        ).toEqual([]);
        expect(
          await queryAll(env.DB, "SELECT id FROM identities WHERE user_id = ? AND organization_id = ?", [
            userId,
            organizationId,
          ]),
        ).toEqual([]);
        expect(
          await queryAll(
            env.DB,
            "SELECT action FROM audit_log WHERE actor_id = ? AND action IN ('user_email_verified', 'organization_identity_activated')",
            [userId],
          ),
        ).toEqual([]);
        expect(
          await queryAll(
            env.DB,
            "SELECT id FROM email_outbox WHERE recipient_user_id = ? AND template_key = 'organization-identity-changed'",
            [userId],
          ),
        ).toEqual([]);
        expect((await publicLinkCall("/preview", link)).status).toBe(200);
      } finally {
        await env.DB.prepare("DROP TRIGGER fail_verification_link").run();
      }
      const retried = await verify(link);
      expect(retried.status, await retried.clone().text()).toBe(200);
      expect(ownEmailAddressVerificationResponseSchema.parse(await retried.json()).joinedOrganization).toEqual({
        id: organizationId,
        name: "Retry Claimed Co",
      });
      expect(
        await queryAll(
          env.DB,
          "SELECT id FROM email_outbox WHERE recipient_user_id = ? AND template_key = 'organization-identity-changed'",
          [userId],
        ),
      ).toHaveLength(1);
      expect((await verify(link)).status).toBe(409);
    },
  );

  it("automatically joins an approved member domain and refuses a forged verification link", async () => {
    const organizationId = await insertOrganization(env.DB, "Member Co");
    await seedOrganizationAggregate(env.DB, organizationId);
    await claimDomain(organizationId, "member.example");
    const { token } = await signedIn("bo@gmail.com");

    await add(token, "bo@member.example");
    const link = await verificationToken("bo@member.example");
    expect((await verify(`${link.slice(0, -4)}AAAA`)).status).toBe(404);

    const verified = await verify(link);
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(ownEmailAddressVerificationResponseSchema.parse(await verified.json())).toMatchObject({
      joinedOrganization: { id: organizationId, name: "Member Co" },
      offeredOrganization: null,
    });

    const offer = await callApi(environment, "/api/v1/users/current/identities/offer", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(affiliationOfferResponseSchema.parse(await offer.json()).offer).toMatchObject({
      kind: "linked",
      organization: { id: organizationId },
      domain: "member.example",
    });
  });

  it("makes a verified address primary while each organization identity keeps the address it follows", async () => {
    const organizationId = await insertOrganization(env.DB, "Open Claimed Co");
    await claimDomain(organizationId, "work.example");
    const { userId, token } = await signedIn("di@gmail.com");
    const added = await add(token, "di@work.example");
    await verify(await verificationToken("di@work.example"));

    const unverified = await add(token, "di@elsewhere.example");
    const refused = await call(
      token,
      `/${unverified.id}`,
      "PATCH",
      ownEmailAddressUpdateSchema.parse({ primary: true }),
    );
    expect(refused.status).toBe(404);

    const changed = await call(token, `/${added.id}`, "PATCH", ownEmailAddressUpdateSchema.parse({ primary: true }));
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(ownEmailAddressResponseSchema.parse(await changed.json()).email).toMatchObject({
      id: null,
      email: "di@work.example",
      primary: true,
    });
    expect(
      await queryAll(env.DB, "SELECT email, email_verified_at IS NOT NULL AS verified FROM users WHERE id = ?", [
        userId,
      ]),
    ).toEqual([{ email: "di@work.example", verified: 1 }]);
    // The old primary address stays on the account, verified, under the row's id.
    expect(
      await queryAll(env.DB, "SELECT email, verified_at IS NOT NULL AS verified FROM user_emails WHERE id = ?", [
        added.id,
      ]),
    ).toEqual([{ email: "di@gmail.com", verified: 1 }]);
    // The organization identity follows the work address, which is now the primary one.
    expect(
      await queryAll(env.DB, "SELECT email_id FROM identities WHERE user_id = ? AND organization_id = ?", [
        userId,
        organizationId,
      ]),
    ).toEqual([{ email_id: null }]);
    expect(
      await queryAll(env.DB, "SELECT action FROM audit_log WHERE action = 'user_primary_email_changed'"),
    ).toHaveLength(1);
  });

  it("removes an address no identity uses and refuses one an organization identity follows", async () => {
    const organizationId = await insertOrganization(env.DB, "Open Claimed Co");
    await claimDomain(organizationId, "work.example");
    const { token } = await signedIn("eva@gmail.com");
    const work = await add(token, "eva@work.example");
    await verify(await verificationToken("eva@work.example"));
    const spare = await add(token, "eva@spare.example");
    await verify(await verificationToken(spare.email));

    // A second organization identity follows the same address: both are named, before and on refusal.
    const secondId = await insertOrganization(env.DB, "Another Follower Co");
    const at = nowIso();
    await env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, email_id, source, show_on_organization_profile, invited_at,
         started_at, created_at, updated_at)
       SELECT ?, user_id, ?, id, 'account', 0, ?, ?, ?, ? FROM user_emails WHERE id = ?`,
    )
      .bind(crypto.randomUUID(), secondId, at, at, at, at, work.id)
      .run();
    const listed = ownEmailAddressesListResponseSchema.parse(await (await call(token, "")).json());
    expect(listed.emails.find((address) => address.id === work.id)?.usedBy.map((used) => used.name)).toEqual([
      "Another Follower Co",
      "Open Claimed Co",
    ]);
    expect(listed.emails.find((address) => address.id === spare.id)?.usedBy).toEqual([]);

    const inUse = await call(token, `/${work.id}`, "DELETE");
    expect(inUse.status).toBe(409);
    expect(await inUse.json()).toMatchObject({
      error: {
        code: "USER_EMAIL_IN_USE",
        message: ownEmailInUseMessage(["Another Follower Co", "Open Claimed Co"]),
      },
    });

    const removed = await call(token, `/${spare.id}`, "DELETE");
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT email FROM user_emails ORDER BY email")).toEqual([
      { email: "eva@work.example" },
    ]);
  });

  it("keeps a way to sign in when the person withdraws or removes the address they sign in with", async () => {
    const { userId, token } = await signedIn("lee@gmail.com");
    const signIn = await add(token, "lee@signin.example");
    await verify(await verificationToken(signIn.email));
    const other = await add(token, "lee@other.example");
    await verify(await verificationToken(other.email));
    // The primary was never proved, so the verified mailboxes keep it from unlocking the account;
    // only the address the person allowed to sign in still can.
    const at = nowIso();
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET email_verified_at = NULL WHERE id = ?").bind(userId),
      env.DB.prepare(
        "INSERT INTO user_email_sign_in_permissions (email_id, revision, enabled_at) VALUES (?, ?, ?)",
      ).bind(signIn.id, crypto.randomUUID(), at),
    ]);
    const lastMethod = { error: { code: LAST_SIGN_IN_METHOD, message: LAST_SIGN_IN_METHOD_MESSAGE } };

    const withdrawn = await call(
      token,
      `/${signIn.id}`,
      "PATCH",
      ownEmailAddressUpdateSchema.parse({ signInEnabled: false }),
    );
    expect(withdrawn.status).toBe(409);
    expect(await withdrawn.json()).toMatchObject(lastMethod);

    const removed = await call(token, `/${signIn.id}`, "DELETE");
    expect(removed.status).toBe(409);
    expect(await removed.json()).toMatchObject(lastMethod);
    expect(await queryAll(env.DB, "SELECT revoked_at FROM user_email_sign_in_permissions")).toEqual([
      { revoked_at: null },
    ]);

    // A passkey is another way in, so the address may go.
    await env.DB.prepare(
      "INSERT INTO passkey_credentials(id,user_id,credential_id,public_key,sign_count,created_at) VALUES(?,?,?,'AQ',0,?)",
    )
      .bind(crypto.randomUUID(), userId, crypto.randomUUID(), at)
      .run();
    const allowed = await call(token, `/${signIn.id}`, "DELETE");
    expect(allowed.status, await allowed.clone().text()).toBe(200);
  });

  it("does not disclose an existing reservation before proof and limits verification mail per person", async () => {
    await insertUser(env.DB, "taken@example.test");
    const { token } = await signedIn("fay@gmail.com");
    const taken = await call(token, "", "POST", { email: "taken@example.test" });
    expect(taken.status).toBe(202);

    environment = { ...env, EMAIL_RATE_LIMITER: createTestRateLimiter(1), IP_RATE_LIMITER: createTestRateLimiter(50) };
    const first = await add(token, "fay@one.example");
    const resend = await call(token, "", "POST", { email: first.email });
    expect(resend.status).toBe(429);
    expect(
      await queryAll(env.DB, "SELECT recipient_email FROM email_outbox WHERE template_key = 'user_email_verification'"),
    ).toEqual([{ recipient_email: "taken@example.test" }, { recipient_email: "fay@one.example" }]);
  });

  it("refuses a verified address the account already holds before sending any link", async () => {
    const account = await signedIn("gil@owner.example");
    const saved = await add(account.token, "gil@saved.example");
    await verify(await verificationToken(saved.email));
    const sentBefore = await queryAll(env.DB, "SELECT id FROM email_outbox");

    for (const [email, message] of [
      ["GIL@Owner.example", OWN_EMAIL_ALREADY_ON_ACCOUNT_MESSAGES.primary],
      ["gil@saved.example", OWN_EMAIL_ALREADY_ON_ACCOUNT_MESSAGES.verified],
    ] as const) {
      const refused = await call(account.token, "", "POST", { email });
      expect(refused.status, email).toBe(409);
      expect(await refused.json()).toMatchObject({ error: { code: OWN_EMAIL_ALREADY_ON_ACCOUNT, message } });
    }
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toEqual(sentBefore);

    // A saved address still waiting for proof can be requested again: its link still works.
    await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), account.userId, "gil@waiting.example", "gil@waiting.example", nowIso())
      .run();
    await add(account.token, "gil@waiting.example");
    expect((await verify(await verificationToken("gil@waiting.example"))).status).toBe(200);
  });

  describe("verification link delivery", () => {
    afterEach(() => vi.unstubAllGlobals());

    async function seedVerificationTemplates(): Promise<void> {
      for (const [templateKey, content] of [
        ["email_layout", "{{{body_html}}}"],
        ["user_email_verification", "Confirm {{email}}: {{verificationUrl}}"],
      ]) {
        const version = await createTemplateVersion(env.DB, { templateKey, content, createdByUserId: null });
        await activateTemplateVersion(env.DB, { templateKey, version: version.version });
      }
    }

    it("reports a link the provider accepted as sent, for a new and a resent link", async () => {
      await seedVerificationTemplates();
      environment = {
        ...environment,
        SENDGRID_API_KEY: "sendgrid-test-key",
        SENDGRID_API_BASE: "https://sendgrid.test/mail/send",
      };
      const fetchMock = vi.fn(async () => new Response(null, { status: 202, headers: { "x-message-id": "sent" } }));
      vi.stubGlobal("fetch", fetchMock);
      const account = await signedIn("hal@owner.example");
      const requested = await call(account.token, "", "POST", { email: "hal@work.example" });
      expect(ownEmailVerificationRequestedResponseSchema.parse(await requested.json()).delivery).toBe("sent");

      const id = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)")
        .bind(id, account.userId, "hal@legacy.example", "hal@legacy.example", nowIso())
        .run();
      const resent = await call(account.token, `/${id}/verification`, "POST");
      expect(resent.status).toBe(202);
      expect(ownEmailVerificationSentResponseSchema.parse(await resent.json())).toEqual({ delivery: "sent" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("reports a link the provider refused as delayed and leaves it to the outbox retry", async () => {
      await seedVerificationTemplates();
      environment = {
        ...environment,
        SENDGRID_API_KEY: "sendgrid-test-key",
        SENDGRID_API_BASE: "https://sendgrid.test/mail/send",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 503 })),
      );
      const account = await signedIn("ivy@owner.example");
      const requested = await call(account.token, "", "POST", { email: "ivy@work.example" });
      expect(requested.status).toBe(202);
      expect(ownEmailVerificationRequestedResponseSchema.parse(await requested.json()).delivery).toBe("delayed");
      expect(
        await queryAll(env.DB, "SELECT status FROM email_outbox WHERE recipient_email = ?", ["ivy@work.example"]),
      ).toEqual([{ status: "retrying" }]);
    });
  });
});
