import { beforeEach, describe, expect, it } from "vitest";
import { DISPOSABLE_EMAIL_REFUSED, WORK_EMAIL_STEER } from "../assets/shared/email-first-copy";
import { env } from "cloudflare:workers";
import { apiValidationErrorDetailsSchema } from "../assets/shared/schemas/api-common";
import { memberJoinVerifyResponseSchema } from "../assets/shared/schemas/member-join";
import { memberApplicationCreateResponseSchema } from "../assets/shared/schemas/member-applications";
import { callApi } from "./helpers/app";
import { createTestRateLimiter, deliveredEmailPayload, queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import {
  membershipApplicationDescriptionAnswers,
  requiredMembershipApplicationAnswers,
  seedMembershipApplicationForm,
} from "./helpers/member-applications";
import { materializeQueuedCapabilityLinks } from "../functions/_lib/auth/capability-links";
import {
  newMemberJoinCapabilityPayload,
  queuedMemberJoinVerificationToken,
} from "../functions/_lib/services/membership/join/capabilities";
import { createMemberApplication } from "../functions/_lib/services/membership/applications/create";
import { prepareIndividualIdentityStatement } from "../functions/_lib/services/users";
import { nowIso } from "../functions/_lib/utils/time";
import { createMemberSession } from "./helpers/auth";
import { mutateBeforeNextBatch, mutateBeforeMatchingQuery } from "./helpers/database-races";
import type { D1RoundTripBudget } from "./helpers/d1-round-trip-budget";

function makeEnv() {
  return {
    ...env,
    IP_RATE_LIMITER: createTestRateLimiter(100),
    EMAIL_RATE_LIMITER: createTestRateLimiter(100),
  } as typeof env;
}

async function postJson(
  testEnv: typeof env,
  path: string,
  body: unknown,
  budget?: D1RoundTripBudget,
): Promise<Response> {
  return callApi(
    testEnv,
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.25" },
      body: JSON.stringify(body),
    },
    budget,
  );
}

async function startAndMaterializeVerification(
  testEnv: typeof env,
  email: string,
  unaffiliatedAttestation = false,
): Promise<string> {
  const started = await postJson(testEnv, "/api/v1/members/join/start", { email, unaffiliatedAttestation });
  expect(started.status).toBe(200);
  await expect(started.json()).resolves.toEqual({ status: "verification_sent" });

  const [outbox] = await queryAll<{ payload_json: string }>(
    testEnv.DB,
    `SELECT payload_json FROM email_outbox
      WHERE template_key = 'membership_join_verify' AND recipient_email = ?
      ORDER BY created_at DESC LIMIT 1`,
    [email],
  );
  expect(outbox).toBeDefined();
  expect(outbox.payload_json).not.toContain("pkc1_");
  expect(outbox.payload_json).toContain("pkcq1_");
  const delivered = await deliveredEmailPayload<{ verificationUrl: string }>(testEnv.DB, testEnv, outbox.payload_json);
  const hash = new URL(delivered.verificationUrl).hash;
  const token = new URLSearchParams(hash.slice(1)).get("verify");
  expect(token).toMatch(/^pkc1_/);
  return token!;
}

async function verifyJoin(testEnv: typeof env, token: string, budget?: D1RoundTripBudget): Promise<Response> {
  return postJson(testEnv, "/api/v1/members/join/verify", { token }, budget);
}

describe("verified-email-first membership join", () => {
  beforeEach(async () => {
    await resetDb();
    await seedMembershipApplicationForm();
  });

  it("steers a personal address to a work address unless the individual capacity is attested", async () => {
    const testEnv = makeEnv();
    const response = await postJson(testEnv, "/api/v1/members/join/start", {
      email: "person@gmail.com",
      unaffiliatedAttestation: false,
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(WORK_EMAIL_STEER);
    expect(await queryAll(testEnv.DB, "SELECT id FROM email_outbox")).toHaveLength(0);

    const individual = await postJson(testEnv, "/api/v1/members/join/start", {
      email: "person@gmail.com",
      unaffiliatedAttestation: true,
    });
    expect(individual.status).toBe(200);
    await expect(individual.json()).resolves.toEqual({ status: "verification_sent" });
  });

  it("steers an ISP mailbox from the server's lists onto the email field, as the browser reads it", async () => {
    const testEnv = makeEnv();
    const response = await postJson(testEnv, "/api/v1/members/join/start", { email: "person@mail.ziggo.nl" });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(apiValidationErrorDetailsSchema.parse(body.error.details).fieldErrors).toEqual({
      email: [WORK_EMAIL_STEER],
    });
    expect(await queryAll(testEnv.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });

  it("rejects disposable addresses before queueing external work", async () => {
    const testEnv = makeEnv();
    const response = await postJson(testEnv, "/api/v1/members/join/start", {
      email: "person@mailinator.com",
      unaffiliatedAttestation: true,
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain(DISPOSABLE_EMAIL_REFUSED);
    expect(await queryAll(testEnv.DB, "SELECT id FROM email_outbox")).toHaveLength(0);
  });

  it("does not materialize a verification link after its request-time deadline", async () => {
    const testEnv = makeEnv();
    const marker = queuedMemberJoinVerificationToken(
      newMemberJoinCapabilityPayload("late@organization.example", "organization"),
      60,
      Math.floor(Date.now() / 1000) - 61,
    );
    const verificationUrl = `https://pkic.test/join/#verify=${marker}`;

    await expect(
      materializeQueuedCapabilityLinks(testEnv.DB, testEnv, {
        verificationUrl,
        __authorizedCapabilityMarkers: [marker],
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_RESOURCE_STALE" });
  });

  it("keeps the usable verification token out of D1 and issues an application capability after proof", async () => {
    const testEnv = makeEnv();
    const token = await startAndMaterializeVerification(testEnv, "applicant@unclaimed.example");
    const response = await verifyJoin(testEnv, token, { maxRoundTrips: 1 });

    expect(response.status).toBe(200);
    const body = memberJoinVerifyResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      status: "application_ready",
      applicantEmail: "applicant@unclaimed.example",
      applicantKind: "organization",
    });
    if (body.status !== "application_ready") throw new Error("Expected application capability");
    expect(body.joinToken).toMatch(/^pkc1_/);
    expect(
      await queryAll(testEnv.DB, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'auth_magic_links'"),
    ).toHaveLength(0);
  });

  it("lets an existing nonmember attendee apply individually using the same canonical person", async () => {
    const testEnv = makeEnv();
    const email = "returning-attendee@unclaimed.example";
    const userId = await insertUser(env.DB, email);
    await env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?").bind(nowIso(), userId).run();
    await env.DB.batch([prepareIndividualIdentityStatement(env.DB, userId, nowIso())]);
    const token = await startAndMaterializeVerification(testEnv, email, true);
    const response = await verifyJoin(testEnv, token);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await response.json()).status).toBe("application_ready");
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email=?", [email])).toEqual([{ id: userId }]);
  });

  it("reuses an active claimed organization, verifies the identity, and returns a normal member session", async () => {
    const testEnv = makeEnv();
    const organizationId = await insertOrganization(testEnv.DB, "Claimed Organization");
    const memberId = await seedOrganizationAggregate(testEnv.DB, organizationId, "A");
    await testEnv.DB.prepare(
      `INSERT INTO organization_domain_claims
         (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, 'claimed.example', NULL, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), organizationId)
      .run();

    const token = await startAndMaterializeVerification(testEnv, "new-person@claimed.example");
    const response = await verifyJoin(testEnv, token);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("pkic_session=");
    const body = memberJoinVerifyResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ status: "organization_access_ready", member: { memberId } });
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(0);
    expect(
      await queryAll(
        testEnv.DB,
        `SELECT identity.id
           FROM identities identity
           JOIN identity_member_capacities capacity ON capacity.identity_id = identity.id
           JOIN users user ON user.id = identity.user_id
          WHERE capacity.member_id = ? AND identity.started_at IS NOT NULL
            AND identity.ended_at IS NULL AND identity.blocked_at IS NULL AND user.normalized_email = ?
            AND user.email_verified_at IS NOT NULL`,
        [memberId, "new-person@claimed.example"],
      ),
    ).toHaveLength(1);
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toHaveLength(1);

    const replay = await verifyJoin(testEnv, token, { maxRoundTrips: 1 });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ status: "already_member" });
    expect(replay.headers.get("set-cookie")).toBeNull();
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toHaveLength(1);
  });

  it("rolls back a join when domain authority disappears after the shared preflight", async () => {
    const testEnv = makeEnv();
    const organizationId = await insertOrganization(testEnv.DB, "Concurrent domain organization");
    await seedOrganizationAggregate(testEnv.DB, organizationId, "A");
    const email = "new-person@domain-race.example";
    await testEnv.DB.prepare(`INSERT INTO organization_domain_claims
      (id,domain,organization_id,created_at,updated_at) VALUES(?,'domain-race.example',?,?,?)`)
      .bind(crypto.randomUUID(), organizationId, nowIso(), nowIso())
      .run();
    const token = await startAndMaterializeVerification(testEnv, email);
    const racingDb = mutateBeforeMatchingQuery(
      testEnv.DB,
      (sql) => sql.includes("INSERT INTO users"),
      () =>
        testEnv.DB.prepare("DELETE FROM organization_domain_claims WHERE organization_id=?").bind(organizationId).run(),
    );
    const response = await verifyJoin({ ...testEnv, DB: racingDb }, token);
    expect(response.ok).toBe(false);
    expect(await queryAll(testEnv.DB, "SELECT id FROM users WHERE normalized_email=?", [email])).toEqual([]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM identities WHERE organization_id=?", [organizationId])).toEqual(
      [],
    );
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toEqual([]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM audit_log WHERE action='membership_join_link_consumed'")).toEqual(
      [],
    );
  });

  it("binds a verified secondary work mailbox to the same person instead of their primary personal mailbox", async () => {
    const testEnv = makeEnv();
    const organizationId = await insertOrganization(testEnv.DB, "Secondary Work Organization");
    const memberId = await seedOrganizationAggregate(testEnv.DB, organizationId, "A");
    await testEnv.DB.prepare(
      `INSERT INTO organization_domain_claims
         (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, 'secondary-work.example', NULL, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), organizationId)
      .run();
    const userId = await insertUser(testEnv.DB, "known-person@gmail.com");
    const emailId = crypto.randomUUID();
    const workEmail = "known-person@secondary-work.example";
    await testEnv.DB.prepare(
      `INSERT INTO user_emails
         (id,user_id,email,normalized_email,verified_at,verification_method,created_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'magic_link', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
      .bind(emailId, userId, workEmail, workEmail)
      .run();
    const token = await startAndMaterializeVerification(testEnv, workEmail);
    const response = await verifyJoin(testEnv, token);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = memberJoinVerifyResponseSchema.parse(await response.json());
    expect(result).toMatchObject({
      status: "organization_access_ready",
      member: { memberId, userId, email: workEmail },
    });
    expect(
      await queryAll(testEnv.DB, "SELECT user_id,email_id,organization_id FROM identities WHERE user_id=?", [userId]),
    ).toEqual([{ user_id: userId, email_id: emailId, organization_id: organizationId }]);
    expect(await queryAll(testEnv.DB, "SELECT id,email FROM users WHERE id=?", [userId])).toEqual([
      { id: userId, email: "known-person@gmail.com" },
    ]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM users WHERE normalized_email=?", [workEmail])).toEqual([]);
    expect(await queryAll(testEnv.DB, "SELECT user_id FROM sessions")).toEqual([{ user_id: userId }]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toEqual([]);
    const replay = await verifyJoin(testEnv, token);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ status: "already_member" });
    expect(await queryAll(testEnv.DB, "SELECT email_id FROM identities WHERE user_id=?", [userId])).toEqual([
      { email_id: emailId },
    ]);
  });

  it("rolls back person, affiliation and proof redemption when session creation fails, and allows a retry", async () => {
    const testEnv = makeEnv();
    const organizationId = await insertOrganization(env.DB, "Atomic join organization");
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    await env.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
      VALUES(?,'atomic-join.example',?,?,?)`)
      .bind(crypto.randomUUID(), organizationId, nowIso(), nowIso())
      .run();
    const email = "new-person@atomic-join.example";
    const token = await startAndMaterializeVerification(testEnv, email);
    await env.DB.prepare(`CREATE TRIGGER refuse_join_session BEFORE INSERT ON sessions
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_JOIN_SESSION_FAILURE'); END`).run();
    try {
      const failed = await verifyJoin(testEnv, token);
      expect(failed.status).toBe(500);
      expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email=?", [email])).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM identities WHERE organization_id=?", [organizationId]),
      ).toHaveLength(0);
      expect(
        await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='membership_join_link_consumed'"),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER refuse_join_session").run();
    }
    const retry = await verifyJoin(testEnv, token);
    expect(retry.status, await retry.clone().text()).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await retry.json()).status).toBe("organization_access_ready");
  });

  it.each([false, true])(
    "preserves an established account while reclaiming its unverified primary (rollback: %s)",
    async (rollback) => {
      const testEnv = makeEnv();
      const organizationId = await insertOrganization(testEnv.DB, "Mailbox preservation organization");
      await seedOrganizationAggregate(testEnv.DB, organizationId, "A");
      const at = nowIso();
      await testEnv.DB.prepare(`INSERT INTO organization_domain_claims
      (id,domain,organization_id,created_at,updated_at) VALUES(?,'preservation.example',?,?,?)`)
        .bind(crypto.randomUUID(), organizationId, at, at)
        .run();
      const email = "applicant@preservation.example";
      const source = await insertUser(testEnv.DB, email);
      const promoted = crypto.randomUUID();
      const retained = crypto.randomUUID();
      await testEnv.DB.batch([
        prepareIndividualIdentityStatement(testEnv.DB, source, at),
        testEnv.DB.prepare(`INSERT INTO user_emails
        (id,user_id,email,normalized_email,verified_at,verification_method,created_at)
        VALUES(?,?,?,?,?,'magic_link',?)`).bind(
          promoted,
          source,
          "owner@established.example",
          "owner@established.example",
          at,
          "2026-01-01T00:00:00.000Z",
        ),
        testEnv.DB.prepare(`INSERT INTO user_emails
        (id,user_id,email,normalized_email,verified_at,verification_method,created_at)
        VALUES(?,?,?,?,?,'magic_link',?)`).bind(
          retained,
          source,
          "alternate@established.example",
          "alternate@established.example",
          at,
          "2026-01-02T00:00:00.000Z",
        ),
      ]);
      await createMemberSession(testEnv.DB, source, "synthetic-established-session");
      const identitiesBefore = await queryAll(
        testEnv.DB,
        "SELECT id,source,started_at,ended_at,blocked_at FROM identities WHERE user_id=?",
        [source],
      );
      const sessionsBefore = await queryAll(
        testEnv.DB,
        "SELECT id,token_hash,revoked_at FROM sessions WHERE user_id=?",
        [source],
      );
      const token = await startAndMaterializeVerification(testEnv, email);
      if (rollback)
        await testEnv.DB.prepare(`CREATE TRIGGER refuse_preservation_session BEFORE INSERT ON sessions
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PRESERVATION_FAILURE'); END`).run();
      let response: Response;
      try {
        response = await verifyJoin(testEnv, token);
      } finally {
        if (rollback) await testEnv.DB.prepare("DROP TRIGGER refuse_preservation_session").run();
      }
      expect(response.status, await response.clone().text()).toBe(rollback ? 500 : 200);
      expect(
        await queryAll(testEnv.DB, "SELECT email,normalized_email,email_verified_at FROM users WHERE id=?", [source]),
      ).toEqual([
        {
          email: rollback ? email : "owner@established.example",
          normalized_email: rollback ? email : "owner@established.example",
          email_verified_at: rollback ? null : at,
        },
      ]);
      expect(
        await queryAll(testEnv.DB, "SELECT id FROM user_emails WHERE user_id=? ORDER BY created_at,id", [source]),
      ).toEqual((rollback ? [promoted, retained] : [retained]).map((id) => ({ id })));
      expect(
        await queryAll(testEnv.DB, "SELECT id,source,started_at,ended_at,blocked_at FROM identities WHERE user_id=?", [
          source,
        ]),
      ).toEqual(identitiesBefore);
      expect(
        await queryAll(testEnv.DB, "SELECT id,token_hash,revoked_at FROM sessions WHERE user_id=?", [source]),
      ).toEqual(sessionsBefore);
      const owners = await queryAll<{ id: string }>(testEnv.DB, "SELECT id FROM users WHERE normalized_email=?", [
        email,
      ]);
      expect(owners).toHaveLength(1);
      if (rollback) {
        expect(owners[0].id).toBe(source);
        expect(
          await queryAll(testEnv.DB, "SELECT id FROM audit_log WHERE action='membership_join_link_consumed'"),
        ).toEqual([]);
      } else {
        expect(owners[0].id).not.toBe(source);
        expect(memberJoinVerifyResponseSchema.parse(await response.json())).toMatchObject({
          status: "organization_access_ready",
          member: { userId: owners[0].id },
        });
      }
    },
  );

  it("does not let an individual attestation bypass an exact claimed organization domain", async () => {
    const testEnv = makeEnv();
    const organizationId = await insertOrganization(testEnv.DB, "Policy Organization");
    await seedOrganizationAggregate(testEnv.DB, organizationId, "A");
    await testEnv.DB.prepare(
      `INSERT INTO organization_domain_claims
         (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, 'policy.example', NULL, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), organizationId)
      .run();

    const token = await startAndMaterializeVerification(testEnv, "employee@policy.example", true);
    const response = await verifyJoin(testEnv, token);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "organization_access_ready" });
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(0);
  });

  it("does not restore a representation that an organization contact blocked", async () => {
    const testEnv = makeEnv();
    const organizationId = await insertOrganization(testEnv.DB, "Blocking Organization");
    const memberId = await seedOrganizationAggregate(testEnv.DB, organizationId, "A");
    const userId = await insertUser(testEnv.DB, "removed@blocked.example");
    const identityId = await addRepresentative(testEnv.DB, memberId, userId);
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO organization_domain_claims
           (id, domain, application_id, organization_id, created_at, updated_at)
         VALUES (?, 'blocked.example', NULL, ?, datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID(), organizationId),
      testEnv.DB.prepare(
        `UPDATE identities
            SET ended_at = started_at, blocked_at = started_at, blocked_by_user_id = ?
          WHERE id = ?`,
      ).bind(userId, identityId),
    ]);

    const token = await startAndMaterializeVerification(testEnv, "removed@blocked.example");
    const response = await verifyJoin(testEnv, token);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "support_required" });
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toHaveLength(0);
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(0);
  });

  it("does not turn an unverified secondary alias into the owning account's login identity", async () => {
    const testEnv = makeEnv();
    const organizationId = await insertOrganization(testEnv.DB, "Alias Organization");
    await seedOrganizationAggregate(testEnv.DB, organizationId, "A");
    await testEnv.DB.prepare(
      `INSERT INTO organization_domain_claims
         (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, 'alias.example', NULL, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), organizationId)
      .run();
    const userId = await insertUser(testEnv.DB, "primary@different.example");
    await testEnv.DB.prepare(
      `INSERT INTO user_emails (id, user_id, email, normalized_email, created_at)
       VALUES (?, ?, 'recipient@alias.example', 'recipient@alias.example', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), userId)
      .run();

    const token = await startAndMaterializeVerification(testEnv, "recipient@alias.example");
    const response = await verifyJoin(testEnv, token);

    expect(response.status).toBe(200);
    const result = memberJoinVerifyResponseSchema.parse(await response.json());
    expect(result.status).toBe("organization_access_ready");
    if (result.status !== "organization_access_ready") throw new Error("Expected proved mailbox access");
    expect(result.member.userId).not.toBe(userId);
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions WHERE user_id=?", [userId])).toHaveLength(0);
    expect(await queryAll(testEnv.DB, "SELECT id FROM identities WHERE user_id = ?", [userId])).toHaveLength(0);
    expect(await queryAll(testEnv.DB, "SELECT id FROM user_emails WHERE user_id=?", [userId])).toEqual([]);
  });

  it("binds a previously verified secondary alias to the same canonical applicant", async () => {
    const testEnv = makeEnv();
    const userId = await insertUser(testEnv.DB, "canonical-applicant@example.test");
    await testEnv.DB.prepare(
      `INSERT INTO user_emails
         (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
       VALUES (?, ?, ?, ?, datetime('now'), 'staff', datetime('now'))`,
    )
      .bind(
        crypto.randomUUID(),
        userId,
        "verified-applicant@organization.example",
        "verified-applicant@organization.example",
      )
      .run();
    const verificationToken = await startAndMaterializeVerification(testEnv, "verified-applicant@organization.example");
    const verification = memberJoinVerifyResponseSchema.parse(
      await (await verifyJoin(testEnv, verificationToken)).json(),
    );
    if (verification.status !== "application_ready") throw new Error("Expected application capability");

    const response = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: verification.applicantEmail,
      applicantName: "Verified Alias Applicant",
      membershipCategory: "F",
      organizationName: "Verified Alias Organization",
      joinToken: verification.joinToken,
      answers: {
        reason: "Apply through a verified alias.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("F"),
      },
    });

    expect(response.status).toBe(201);
    expect(
      await queryAll<{ applicant_user_id: string | null; applicant_email: string }>(
        testEnv.DB,
        "SELECT applicant_user_id, applicant_email FROM member_applications",
      ),
    ).toEqual([{ applicant_user_id: userId, applicant_email: "verified-applicant@organization.example" }]);
  });

  it("binds one verified capability to one individual application and rejects replay", async () => {
    const testEnv = makeEnv();
    const verificationToken = await startAndMaterializeVerification(testEnv, "independent@gmail.com", true);
    const verification = memberJoinVerifyResponseSchema.parse(
      await (await verifyJoin(testEnv, verificationToken)).json(),
    );
    if (verification.status !== "application_ready") throw new Error("Expected application capability");

    const payload = {
      applicantEmail: verification.applicantEmail,
      applicantName: "Independent Person",
      membershipCategory: "H6",
      joinToken: verification.joinToken,
      answers: {
        reason: "I want to contribute to the PKI community.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("H6"),
      },
    };
    const first = await postJson(testEnv, "/api/v1/members/applications", payload);
    expect(first.status).toBe(201);
    expect(memberApplicationCreateResponseSchema.parse(await first.json()).stage).toBe("submitted");

    const replay = await postJson(testEnv, "/api/v1/members/applications", payload);
    expect(replay.status).toBe(409);
    // The open application already refuses the replay before the spent capability does.
    await expect(replay.json()).resolves.toMatchObject({ error: { code: "APPLICATION_ALREADY_PENDING" } });
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(1);
  });

  it("binds an existing primary-email applicant to the canonical user instead of the email string", async () => {
    const testEnv = makeEnv();
    const userId = await insertUser(testEnv.DB, "existing-applicant@organization.example");
    const verificationToken = await startAndMaterializeVerification(testEnv, "existing-applicant@organization.example");
    const verification = memberJoinVerifyResponseSchema.parse(
      await (await verifyJoin(testEnv, verificationToken)).json(),
    );
    if (verification.status !== "application_ready") throw new Error("Expected application capability");

    const response = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: verification.applicantEmail,
      applicantName: "Existing Applicant",
      membershipCategory: "F",
      organizationName: "Existing Applicant Organization",
      joinToken: verification.joinToken,
      answers: {
        reason: "Apply through the verified canonical identity.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("F"),
      },
    });
    expect(response.status).toBe(201);
    expect(
      await queryAll<{ applicant_user_id: string | null; applicant_email: string }>(
        testEnv.DB,
        "SELECT applicant_user_id, applicant_email FROM member_applications",
      ),
    ).toEqual([
      {
        applicant_user_id: userId,
        applicant_email: "existing-applicant@organization.example",
      },
    ]);
  });

  it("rolls back an application when its verified canonical identity changes before commit", async () => {
    const testEnv = makeEnv();
    const userId = await insertUser(testEnv.DB, "application-race@organization.example");
    const racingDb = mutateBeforeNextBatch(testEnv.DB, () =>
      testEnv.DB.prepare("UPDATE users SET email = ?, normalized_email = ?, updated_at = ? WHERE id = ?")
        .bind("changed@organization.example", "changed@organization.example", new Date().toISOString(), userId)
        .run(),
    );

    await expect(
      createMemberApplication(racingDb, {
        applicantEmail: "application-race@organization.example",
        applicantName: "Application Race",
        membershipCategory: "F",
        organizationName: "Application Race Organization",
        answers: {
          reason: "Race the verified account binding.",
          ...requiredMembershipApplicationAnswers,
          ...membershipApplicationDescriptionAnswers("F"),
        },
        appBaseUrl: "https://app.test",
        joinCapabilityId: crypto.randomUUID(),
        applicantKind: "organization",
        applicantUserId: userId,
      }),
    ).rejects.toMatchObject({ status: 409, code: "MEMBER_JOIN_CONTEXT_CHANGED" });
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toEqual([]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM form_submissions")).toEqual([]);
  });

  it("does not let a verified capability authorize a different mailbox or category kind", async () => {
    const testEnv = makeEnv();
    const verificationToken = await startAndMaterializeVerification(testEnv, "employee@organization.example");
    const verification = memberJoinVerifyResponseSchema.parse(
      await (await verifyJoin(testEnv, verificationToken)).json(),
    );
    if (verification.status !== "application_ready") throw new Error("Expected application capability");

    const wrongEmail = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: "attacker@organization.example",
      applicantName: "Wrong Address",
      membershipCategory: "A",
      organizationName: "Organization",
      joinToken: verification.joinToken,
      answers: { reason: "Attempted capability substitution.", ...requiredMembershipApplicationAnswers },
    });
    expect(wrongEmail.status).toBe(401);

    const wrongKind = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: verification.applicantEmail,
      applicantName: "Wrong Kind",
      membershipCategory: "H6",
      joinToken: verification.joinToken,
      answers: { reason: "Attempted category substitution.", ...requiredMembershipApplicationAnswers },
    });
    expect(wrongKind.status).toBe(422);
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(0);
  });
});
