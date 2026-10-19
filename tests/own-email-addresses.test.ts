/**
 * A signed-in person manages their own email addresses: add one, prove it
 * through the emailed link, make a verified one primary, and remove one no
 * organization identity uses. A verified work address joins the organization
 * its domain belongs to through the shared rule.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { affiliationOfferResponseSchema } from "../assets/shared/schemas/affiliation-offer";
import {
  ownEmailAddressAddSchema,
  ownEmailAddressResponseSchema,
  ownEmailAddressUpdateSchema,
  ownEmailAddressVerificationPreviewResponseSchema,
  ownEmailAddressVerificationResponseSchema,
  ownEmailAddressVerificationSchema,
  ownEmailAddressesListResponseSchema,
} from "../assets/shared/schemas/own-email-addresses";
import type { Env } from "../functions/_lib/types";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createMemberSession } from "./helpers/auth";
import { createTestRateLimiter, deliveredEmailPayload, queryAll } from "./helpers/context";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

let environment: Env;
let tokenCounter = 0;

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
  return { userId, token: await createMemberSession(env.DB, userId, `own-email-token-${tokenCounter}`) };
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
  expect(response.status, await response.clone().text()).toBe(201);
  return ownEmailAddressResponseSchema.parse(await response.json()).email;
}

/** The verification link the outbox would deliver to `email`, as the token the page sends back. */
async function verificationToken(email: string): Promise<string> {
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    `SELECT payload_json FROM email_outbox WHERE template_key = 'user_email_verification' AND recipient_email = ?
      ORDER BY rowid DESC LIMIT 1`,
    [email],
  );
  expect(outbox).toBeDefined();
  const payload = await deliveredEmailPayload<{ verificationUrl: string }>(env.DB, environment, outbox!.payload_json);
  const token = new URLSearchParams(new URL(payload.verificationUrl).hash.split("?", 2)[1]).get("token");
  if (!token) throw new Error("Missing verification capability");
  return token;
}

/** The page a link opens calls these without any session: the link alone proves the mailbox. */
function publicLinkCall(path: string, linkToken: string): Promise<Response> {
  return callApi(environment, `/api/v1/auth/email-verifications${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

  it("adds an address, verifies it through the emailed link once, and joins the organization its domain belongs to", async () => {
    const organizationId = await insertOrganization(env.DB, "Open Claimed Co");
    await claimDomain(organizationId, "open-claimed.example");
    const { userId, token } = await signedIn("ana@gmail.com");

    const added = await add(token, "ana@open-claimed.example");
    expect(added).toMatchObject({
      email: "ana@open-claimed.example",
      primary: false,
      verifiedAt: null,
      signInEnabled: false,
    });

    const link = await verificationToken("ana@open-claimed.example");
    const preview = await publicLinkCall("/preview", link);
    expect(ownEmailAddressVerificationPreviewResponseSchema.parse(await preview.json())).toEqual({
      email: "ana@open-claimed.example",
    });
    // Previewing changes nothing; verifying needs no session.
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

  it("offers a member organization, which the person signs in to join, and refuses a forged link", async () => {
    const organizationId = await insertOrganization(env.DB, "Member Co");
    await seedOrganizationAggregate(env.DB, organizationId);
    await claimDomain(organizationId, "member.example");
    const { token } = await signedIn("bo@gmail.com");

    const added = await add(token, "bo@member.example");
    const link = await verificationToken("bo@member.example");
    expect((await verify(`${link.slice(0, -4)}AAAA`)).status).toBe(404);

    const verified = await verify(link);
    expect(verified.status, await verified.clone().text()).toBe(200);
    expect(ownEmailAddressVerificationResponseSchema.parse(await verified.json())).toMatchObject({
      joinedOrganization: null,
      offeredOrganization: { id: organizationId, name: "Member Co" },
    });

    const offer = await callApi(environment, "/api/v1/users/current/identities/offer", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(affiliationOfferResponseSchema.parse(await offer.json()).offer).toMatchObject({
      kind: "organization",
      organization: { id: organizationId },
      emailId: added.id,
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
    expect(refused.status).toBe(409);

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

    const inUse = await call(token, `/${work.id}`, "DELETE");
    expect(inUse.status).toBe(409);
    expect(((await inUse.json()) as { error: { code: string } }).error.code).toBe("USER_EMAIL_IN_USE");

    const removed = await call(token, `/${spare.id}`, "DELETE");
    expect(removed.status, await removed.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT email FROM user_emails ORDER BY email")).toEqual([
      { email: "eva@work.example" },
    ]);
  });

  it("refuses an address already reserved and limits verification mail per person", async () => {
    await insertUser(env.DB, "taken@example.test");
    const { token } = await signedIn("fay@gmail.com");
    const taken = await call(token, "", "POST", { email: "taken@example.test" });
    expect(taken.status).toBe(409);

    environment = { ...env, EMAIL_RATE_LIMITER: createTestRateLimiter(1), IP_RATE_LIMITER: createTestRateLimiter(50) };
    const first = await add(token, "fay@one.example");
    const resend = await call(token, `/${first.id}/verification`, "POST");
    expect(resend.status).toBe(429);
    expect(
      await queryAll(env.DB, "SELECT recipient_email FROM email_outbox WHERE template_key = 'user_email_verification'"),
    ).toEqual([{ recipient_email: "fay@one.example" }]);
  });
});
