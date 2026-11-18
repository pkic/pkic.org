import "../functions/http-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "./helpers/app";
import { createTestRateLimiter, deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { parseCapabilityToken } from "../functions/_lib/auth/capability-token";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";
import { prepareAccountIdentityStatement } from "../functions/_lib/services/users";
import { createMemberSession } from "./helpers/auth";
import { insertOrganization, insertUser } from "./helpers/membership";
import { redeemUserSignUpCapability } from "../functions/_lib/auth/user-sign-up";
import type { DatabaseLike } from "../functions/_lib/types";
import { ACCOUNT_POLICIES, ACCOUNT_POLICIES_COPY } from "../assets/shared/account-policies";

/** Background work a request starts (outbox delivery); awaited so it never runs into the next test. */
const background: Promise<unknown>[] = [];

/** A sign-up request accepts the account policies unless the test says otherwise. */
function withPolicies(path: string, body: unknown): unknown {
  return path === "/api/v1/auth/sign-up" && body && typeof body === "object"
    ? { acceptsAccountPolicies: true, ...body }
    : body;
}

async function call(path: string, body: unknown, environment: object = env): Promise<Response> {
  return app.fetch(
    new Request(`https://app.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(withPolicies(path, body)),
    }),
    environment as never,
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

    const verified = await call("/api/v1/auth/verify-link", { token, organization: { personal: true } });
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
    // The session lives only while the address it was made through still signs in.
    expect(
      await queryAll(env.DB, "SELECT normalized_email FROM session_email_authentication WHERE session_id = ?", [
        session.sessionId,
      ]),
    ).toEqual([{ normalized_email: "ada@organization.example" }]);
    // Starting the account records the Code of Conduct agreement and the Privacy Policy notice in their current version.
    expect(
      await queryAll(
        env.DB,
        "SELECT term_key, term_version FROM account_policy_acceptances WHERE user_id = ? ORDER BY term_key",
        [user.id],
      ),
    ).toEqual(
      ACCOUNT_POLICIES.map(({ termKey, version }) => ({ term_key: termKey, term_version: version })).sort((a, b) =>
        a.term_key.localeCompare(b.term_key),
      ),
    );

    expect((await call("/api/v1/auth/verify-link", { token, organization: { personal: true } })).status).toBe(409);
  });

  it("refuses to start an account without agreeing to follow the Code of Conduct", async () => {
    for (const acceptsAccountPolicies of [undefined, false]) {
      const refused = await call("/api/v1/auth/sign-up", {
        email: "ada@organization.example",
        acceptsAccountPolicies,
      });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({
        error: { details: { fieldErrors: { acceptsAccountPolicies: [ACCOUNT_POLICIES_COPY.required] } } },
      });
    }
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });

  it("refuses a return path that carries an invitation token, so no token reaches the outbox", async () => {
    await seedEventAndAdmin(env.DB);
    const limited = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(50),
      IP_RATE_LIMITER: createTestRateLimiter(50),
    };
    // However the key is written: percent-encoded, or as another token the page reads.
    for (const query of [
      "invite=secret-invitation-token&id=1",
      "id=1&%69nvite=secret",
      "token=secret",
      "verify=secret",
    ])
      for (const [path, email] of [
        ["/api/v1/auth/sign-up", "ada@organization.example"],
        ["/api/v1/auth/request-link", "admin@pkic.org"],
      ] as const) {
        const returnPath = `/events/pqc-2027/register?${query}`;
        expect((await call(path, { email, returnPath }, limited)).status, query).toBe(400);
      }
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });

  it("keeps page state in the return path, and starts an account from a malformed event path", async () => {
    await seedEventAndAdmin(env.DB);
    const limited = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(50),
      IP_RATE_LIMITER: createTestRateLimiter(50),
    };
    const kept = await call(
      "/api/v1/auth/sign-up",
      { email: "ada@organization.example", returnPath: "/events/pqc-2027/register?id=1&ref=ABC123&tab=details" },
      limited,
    );
    expect(kept.status, await kept.clone().text()).toBe(200);
    const malformed = await call(
      "/api/v1/auth/sign-up",
      { email: "bea@organization.example", returnPath: "/events/%E0/register/" },
      limited,
    );
    expect(malformed.status, await malformed.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toHaveLength(2);
  });

  it("claims an unverified alias for a new account without adopting the account that added it", async () => {
    const email = "casey.claimed@organization.example";
    const other = await insertUser(env.DB, "other@other.example");
    await env.DB.prepare("INSERT INTO user_emails(id,user_id,email,normalized_email,created_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), other, email, email, new Date().toISOString())
      .run();
    expect((await call("/api/v1/auth/sign-up", { email })).status).toBe(200);
    const verified = await call("/api/v1/auth/verify-link", {
      token: linkToken((await lastLink())!),
      organization: { personal: true },
    });
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
    const verified = await call("/api/v1/auth/verify-link", {
      token: linkToken((await lastLink())!),
      organization: { personal: true },
    });
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

    expect((await call("/api/v1/auth/verify-link", { token, organization: { personal: true } })).status).toBe(404);
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

  it("names the registration the link is for, alike for a new address and one that already signs in", async () => {
    await seedEventAndAdmin(env.DB);
    await env.DB.prepare("UPDATE events SET visibility = 'public' WHERE slug = 'pqc-2026'").run();
    const returnPath = "/events/pqc-2026/register";
    for (const email of ["ada@organization.example", "admin@pkic.org"]) {
      expect((await call("/api/v1/auth/sign-up", { email, returnPath })).status, email).toBe(200);
      const [outbox] = await queryAll<{ template_key: string; payload_json: string }>(
        env.DB,
        "SELECT template_key, payload_json FROM email_outbox ORDER BY rowid DESC LIMIT 1",
      );
      expect(outbox!.template_key, email).toBe("user_sign_up_link");
      expect(JSON.parse(outbox!.payload_json), email).toMatchObject({
        registration: true,
        eventName: "PQC Conference 2026",
      });
    }
  });

  it("keeps an event that is not public out of the link's email", async () => {
    await seedEventAndAdmin(env.DB);
    const returnPath = "/events/pqc-2026/register";
    expect((await call("/api/v1/auth/sign-up", { email: "ada@organization.example", returnPath })).status).toBe(200);
    const payload = JSON.parse(await storedPayload());
    expect(payload.eventName).toBeUndefined();
    expect(payload.registration).toBeUndefined();
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
    // A verified address that stopped signing in when the representation it belongs to ended.
    const organizationId = await insertOrganization(env.DB, "Organization");
    const identityId = crypto.randomUUID();
    const at = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO identities (id, user_id, organization_id, source, verified_email_domain, invited_at, started_at,
           ended_at, created_at, updated_at)
         VALUES (?, ?, ?, 'verified_email', 'organization.example', ?, ?, ?, ?, ?)`,
      ).bind(identityId, admin.id, organizationId, at, at, at, at, at),
      env.DB.prepare(
        `INSERT INTO user_emails (id, user_id, identity_id, email, normalized_email, verified_at, verification_method,
           created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'magic_link', ?)`,
      ).bind(
        crypto.randomUUID(),
        admin.id,
        identityId,
        "second@organization.example",
        "second@organization.example",
        at,
        at,
      ),
    ]);

    expect((await call("/api/v1/auth/sign-up", { email: "second@organization.example" })).status).toBe(200);
    // Its mailbox learns how to sign in instead; no link, account, or session.
    expect(await queryAll(env.DB, "SELECT template_key FROM email_outbox")).toEqual([
      { template_key: "user_sign_in_unavailable" },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toHaveLength(0);
  });
  it("refuses the second of two sign-up links for one address redeemed at the same time", async () => {
    const email = "twice@gmail.com";
    expect((await call("/api/v1/auth/sign-up", { email, unaffiliatedAttestation: true })).status).toBe(200);
    const first = linkToken((await lastLink())!);
    expect((await call("/api/v1/auth/sign-up", { email, unaffiliatedAttestation: true })).status).toBe(200);
    const second = linkToken((await lastLink())!);
    expect(second).not.toBe(first);

    // The second redemption reads the address as unused, then the first commits before its batch does.
    let raced = false;
    const racingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property !== "batch") return Reflect.get(target, property, target);
        return async (statements: Parameters<DatabaseLike["batch"]>[0]) => {
          if (!raced) {
            raced = true;
            expect((await call("/api/v1/auth/verify-link", { token: first })).status).toBe(200);
          }
          return target.batch(statements as never);
        };
      },
    }) as unknown as DatabaseLike;
    const refused = await redeemUserSignUpCapability(racingDb, {
      token: second,
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      sessionTtlHours: 1,
    }).catch((error: unknown) => error);
    expect(raced).toBe(true);
    expect(refused).toMatchObject({ code: expect.stringMatching(/^MAGIC_LINK_(INVALID|USED)$/) });
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [email])).toHaveLength(1);
  });
  it("counts sign-up and sign-in link requests against one limit per address", async () => {
    const limitedEnv = {
      ...env,
      EMAIL_RATE_LIMITER: createTestRateLimiter(2),
      IP_RATE_LIMITER: createTestRateLimiter(20),
    };
    const request = (path: string) =>
      app.fetch(
        new Request(`https://app.test${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.20" },
          body: JSON.stringify(withPolicies(path, { email: "limited@gmail.com", unaffiliatedAttestation: true })),
        }),
        limitedEnv as never,
        { passThroughOnException() {}, waitUntil: (work: Promise<unknown>) => void background.push(work) } as any,
      );
    expect((await request("/api/v1/auth/sign-up")).status).toBe(200);
    expect((await request("/api/v1/auth/request-link")).status).toBe(200);
    expect((await request("/api/v1/auth/sign-up")).status).toBe(429);
  });
});
