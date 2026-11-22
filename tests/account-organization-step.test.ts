import "../functions/http-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "./helpers/app";
import { deliveredEmailPayload, queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { nowIso } from "../functions/_lib/utils/time";
import { insertOrganization, insertUser } from "./helpers/membership";
import { userAuthEstablishedResponseSchema, userAuthVerifyResponseSchema } from "../assets/shared/schemas/user-auth";
import { accountOrganizationRequiredSchema } from "../assets/shared/schemas/account-organization";
import { ACCOUNT_ORGANIZATION_COPY } from "../assets/shared/account-organization-copy";
import { signInJoinApplicant } from "./helpers/member-join";
import { recordPersonalAddressAnswer } from "./helpers/account-organization";
import { authenticateWithPasskey, registerSyntheticPasskey } from "./helpers/passkey-sign-in";

/**
 * Account setup's organization step: a work address with no organization gets
 * no session until the person names the organization or, on a domain no
 * organization has claimed, uses the address as a personal one.
 */
const background: Promise<unknown>[] = [];
// Each test is its own client, so the per-address rate limit counts one test's requests, never the file's.
let clientIp = "";
let clientCount = 0;

async function call(path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": clientIp },
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

async function lastLinkToken(): Promise<string> {
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox ORDER BY rowid DESC LIMIT 1",
  );
  const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox!.payload_json);
  return new URLSearchParams(new URL(delivered.magicLinkUrl).hash.split("?", 2)[1]).get("token")!;
}

async function signUpLink(email: string, unaffiliatedAttestation = false): Promise<string> {
  expect(
    (await call("/api/v1/auth/sign-up", { email, unaffiliatedAttestation, acceptsAccountPolicies: true })).status,
  ).toBe(200);
  return lastLinkToken();
}

async function signInLink(email: string): Promise<string> {
  expect((await call("/api/v1/auth/request-link", { email })).status).toBe(200);
  return lastLinkToken();
}

async function verify(token: string, body: object = {}) {
  const response = await call("/api/v1/auth/verify-link", { token, ...body });
  expect(response.status, await response.clone().text()).toBe(200);
  return userAuthVerifyResponseSchema.parse(await response.json());
}

async function sessions(): Promise<number> {
  return (await queryAll(env.DB, "SELECT id FROM sessions")).length;
}

async function claimDomain(domain: string, name: string): Promise<string> {
  const organizationId = await insertOrganization(env.DB, name);
  await env.DB.prepare(
    "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,?,?,datetime('now'),datetime('now'))",
  )
    .bind(crypto.randomUUID(), domain, organizationId)
    .run();
  return organizationId;
}

describe("account setup's organization step", () => {
  beforeEach(async () => {
    clientCount += 1;
    clientIp = `198.51.100.${clientCount}`;
    await resetDb();
  });
  afterEach(async () => {
    await Promise.allSettled(background.splice(0));
  });

  it("gives a work address no session until it is answered, and asks only once", async () => {
    const token = await signUpLink("ada@unclaimed.example");

    // Opening the link asks; it may be opened again while the step is open.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const asked = accountOrganizationRequiredSchema.parse(await verify(token));
      expect(asked.organizationRequired.personalAllowed).toBe(true);
      expect(asked.organizationRequired.affiliation.email).toBe("ada@unclaimed.example");
    }
    expect(await sessions()).toBe(0);
    expect(await queryAll(env.DB, "SELECT id FROM users")).toHaveLength(0);

    const established = userAuthEstablishedResponseSchema.parse(
      await verify(token, { organization: { personal: true } }),
    );
    expect(established.identity.email).toBe("ada@unclaimed.example");
    expect(await sessions()).toBe(1);
    expect(
      await queryAll(env.DB, "SELECT organization_id FROM affiliation_offer_dismissals WHERE user_id = ?", [
        established.identity.id,
      ]),
    ).toEqual([{ organization_id: null }]);

    // The next sign-in reuses the answer.
    const again = await verify(await signInLink("ada@unclaimed.example"));
    expect("organizationRequired" in again).toBe(false);
  });

  it("reuses the personal answer given when the account was started", async () => {
    const established = await verify(await signUpLink("lin@own-domain.example", true));
    expect("organizationRequired" in established).toBe(false);
    expect(await sessions()).toBe(1);
  });

  it("never treats a claimed domain as personal, and signs in once the organization is chosen", async () => {
    const organizationId = await claimDomain("claimed.example", "Claimed Organization");
    const token = await signUpLink("omar@claimed.example");

    const asked = accountOrganizationRequiredSchema.parse(await verify(token));
    expect(asked.organizationRequired.personalAllowed).toBe(false);
    expect(asked.organizationRequired.affiliation.organizations.map(({ id }) => id)).toContain(organizationId);

    // A personal answer does not settle a claimed domain.
    expect("organizationRequired" in (await verify(token, { organization: { personal: true } }))).toBe(true);
    expect(await sessions()).toBe(0);

    const prepared = accountOrganizationRequiredSchema.parse(
      await verify(token, { affiliation: { selection: { organizationId, jobTitle: "Security architect" } } }),
    );
    const contextToken = prepared.organizationRequired.affiliation.contextToken;
    expect(contextToken).toBeTruthy();
    const established = userAuthEstablishedResponseSchema.parse(
      await verify(token, { organization: { contextToken } }),
    );
    const added = established.actingIdentities.find((identity) => identity.organizationId === organizationId);
    expect(added).toMatchObject({ organizationName: "Claimed Organization", jobTitle: "Security architect" });
    // The person just said they represent it, so the new session acts as it.
    expect(established.actingIdentityId).toBe(added!.id);
    expect(await sessions()).toBe(1);
  });

  it("asks again after a personal answer once an organization claims the domain", async () => {
    await verify(await signUpLink("kim@later-claimed.example"), { organization: { personal: true } });
    await claimDomain("later-claimed.example", "Later Organization");

    const token = await signInLink("kim@later-claimed.example");
    const asked = accountOrganizationRequiredSchema.parse(await verify(token));
    expect(asked.organizationRequired.personalAllowed).toBe(false);

    // Signing in, the organization they choose is the one the session acts as.
    const [organization] = asked.organizationRequired.affiliation.organizations;
    const prepared = accountOrganizationRequiredSchema.parse(
      await verify(token, { affiliation: { selection: { organizationId: organization!.id, jobTitle: "Engineer" } } }),
    );
    const established = userAuthEstablishedResponseSchema.parse(
      await verify(token, { organization: { contextToken: prepared.organizationRequired.affiliation.contextToken! } }),
    );
    const acting = established.actingIdentities.find((identity) => identity.id === established.actingIdentityId);
    expect(acting?.organizationName).toBe("Later Organization");
  });

  it("never asks a free mailbox", async () => {
    const established = await verify(await signUpLink("someone@gmail.com", true));
    expect("organizationRequired" in established).toBe(false);
  });

  it("refuses a passkey until the step is answered through an email link", async () => {
    const person = await signInJoinApplicant(env, "rae@passkey-work.example");
    const { authenticator } = await registerSyntheticPasskey(env, person.cookie.replace("pkic_session=", ""));
    const refused = await authenticateWithPasskey(env, authenticator);
    expect(refused.status).toBe(409);
    await expect(refused.json()).resolves.toMatchObject({
      error: { code: "ACCOUNT_ORGANIZATION_REQUIRED", message: ACCOUNT_ORGANIZATION_COPY.passkeyRefused },
    });

    await recordPersonalAddressAnswer(env.DB, person.userId);
    expect((await authenticateWithPasskey(env, authenticator)).status).toBe(200);
  });
  it("signs a passkey in when the work primary was retired by an ended representation", async () => {
    const organizationId = await claimDomain("retired-work.example", "Former Employer");
    const person = await signInJoinApplicant(env, "ray@retired-work.example");
    const { authenticator } = await registerSyntheticPasskey(env, person.cookie.replace("pkic_session=", ""));
    await env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, invited_at, started_at, ended_at, created_at, updated_at)
       VALUES (?, ?, ?, 'verified_domain', datetime('now'), datetime('now'), datetime('now'), datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), person.userId, organizationId)
      .run();

    // The address no longer signs in, so it asks for no organization either.
    const response = await authenticateWithPasskey(env, authenticator);
    expect(response.status, await response.clone().text()).toBe(200);
  });

  it("does not ask a person the organization already invited", async () => {
    const organizationId = await claimDomain("inviting.example", "Inviting Organization");
    const userId = await insertUser(env.DB, "eve@inviting.example");
    await env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, invited_at, created_at, updated_at)
       VALUES (?, ?, ?, 'staff', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), userId, organizationId, nowIso(), nowIso(), nowIso())
      .run();

    const established = await verify(await signInLink("eve@inviting.example"));
    expect("organizationRequired" in established).toBe(false);
    expect(await sessions()).toBe(1);
  });

  it("asks again, without a session, when a new organization's name already exists", async () => {
    await claimDomain("claimed.example", "Claimed Organization");
    await insertOrganization(env.DB, "Another Organization");
    const token = await signUpLink("omar@claimed.example");
    expect(accountOrganizationRequiredSchema.parse(await verify(token)).organizationRequired.personalAllowed).toBe(
      false,
    );

    for (const organizationName of ["Claimed Organization", "another  organization"]) {
      const refused = await call("/api/v1/auth/verify-link", {
        token,
        affiliation: { selection: { organizationId: null, organizationName, jobTitle: "Security architect" } },
      });
      expect(refused.status, await refused.clone().text()).toBe(422);
      expect(await refused.json()).toMatchObject({ error: { code: "ORGANIZATION_NAME_EXISTS" } });
    }
    expect(await sessions()).toBe(0);
  });

  it("opens the session without the organization when only a reviewer can add it", async () => {
    const organizationId = await claimDomain("blocked.example", "Blocking Organization");
    const person = await signInJoinApplicant(env, "bo@blocked.example");
    await env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, source, invited_at, ended_at, blocked_at, created_at, updated_at)
       VALUES (?, ?, ?, 'verified_email', datetime('now'), datetime('now'), datetime('now'), datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), person.userId, organizationId)
      .run();
    const token = await signInLink("bo@blocked.example");
    const asked = accountOrganizationRequiredSchema.parse(await verify(token));
    expect(asked.organizationRequired.personalAllowed).toBe(false);

    const prepared = accountOrganizationRequiredSchema.parse(
      await verify(token, { affiliation: { selection: { organizationId, jobTitle: "Engineer" } } }),
    );
    const established = userAuthEstablishedResponseSchema.parse(
      await verify(token, { organization: { contextToken: prepared.organizationRequired.affiliation.contextToken! } }),
    );
    expect(established.identity.id).toBe(person.userId);
    expect(established.actingIdentities.some((identity) => identity.organizationId === organizationId)).toBe(false);
  });
});
