import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { memberJoinVerifyResponseSchema } from "../assets/shared/schemas/member-join";
import { memberApplicationCreateResponseSchema } from "../assets/shared/schemas/member-applications";
import { callApi } from "./helpers/app";
import { createTestRateLimiter, deliveredEmailPayload, queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { requiredMembershipApplicationAnswers, seedMembershipApplicationForm } from "./helpers/member-applications";
import { materializeQueuedCapabilityLinks } from "../functions/_lib/auth/capability-links";
import {
  newMemberJoinCapabilityPayload,
  queuedMemberJoinVerificationToken,
} from "../functions/_lib/services/membership/join/capabilities";
import { createMemberApplication } from "../functions/_lib/services/membership/applications/create";
import { mutateBeforeNextBatch } from "./helpers/database-races";

function makeEnv() {
  return {
    ...env,
    IP_RATE_LIMITER: createTestRateLimiter(100),
    EMAIL_RATE_LIMITER: createTestRateLimiter(100),
  } as typeof env;
}

async function postJson(testEnv: typeof env, path: string, body: unknown): Promise<Response> {
  return callApi(testEnv, path, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.25" },
    body: JSON.stringify(body),
  });
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

async function verifyJoin(testEnv: typeof env, token: string): Promise<Response> {
  return postJson(testEnv, "/api/v1/members/join/verify", { token });
}

describe("verified-email-first membership join", () => {
  beforeEach(async () => {
    await resetDb();
    await seedMembershipApplicationForm();
  });

  it("requires the explicit unaffiliated attestation before emailing a personal address", async () => {
    const testEnv = makeEnv();
    const response = await postJson(testEnv, "/api/v1/members/join/start", {
      email: "person@gmail.com",
      unaffiliatedAttestation: false,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "unaffiliated_attestation_required" });
    expect(
      await queryAll(testEnv.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", ["person@gmail.com"]),
    ).toHaveLength(0);
  });

  it("rejects disposable addresses before queueing external work", async () => {
    const testEnv = makeEnv();
    const response = await postJson(testEnv, "/api/v1/members/join/start", {
      email: "person@mailinator.com",
      unaffiliatedAttestation: true,
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "DISPOSABLE_EMAIL_NOT_ALLOWED" } });
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
    const response = await verifyJoin(testEnv, token);

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
        `SELECT representative.id
           FROM organization_representatives representative
           JOIN users user ON user.id = representative.user_id
          WHERE representative.member_id = ? AND representative.left_at IS NULL
            AND representative.blocked_at IS NULL AND user.normalized_email = ?
            AND user.email_verified_at IS NOT NULL`,
        [memberId, "new-person@claimed.example"],
      ),
    ).toHaveLength(1);
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toHaveLength(1);

    const replay = await verifyJoin(testEnv, token);
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toMatchObject({ error: { code: "MEMBER_JOIN_LINK_USED" } });
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toHaveLength(1);
  });

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
    const representativeId = await addRepresentative(testEnv.DB, memberId, userId);
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO organization_domain_claims
           (id, domain, application_id, organization_id, created_at, updated_at)
         VALUES (?, 'blocked.example', NULL, ?, datetime('now'), datetime('now'))`,
      ).bind(crypto.randomUUID(), organizationId),
      testEnv.DB.prepare(
        `UPDATE organization_representatives
            SET left_at = joined_at, blocked_at = datetime('now'), blocked_by_user_id = ?
          WHERE id = ?`,
      ).bind(userId, representativeId),
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
    await expect(response.json()).resolves.toEqual({ status: "support_required" });
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toHaveLength(0);
    expect(
      await queryAll(testEnv.DB, "SELECT id FROM organization_representatives WHERE user_id = ?", [userId]),
    ).toHaveLength(0);
    const [alias] = await queryAll<{ verified_at: string | null }>(
      testEnv.DB,
      "SELECT verified_at FROM user_emails WHERE user_id = ?",
      [userId],
    );
    expect(alias.verified_at).toBeNull();
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
      answers: { reason: "Apply through a verified alias.", ...requiredMembershipApplicationAnswers },
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
      answers: { reason: "I want to contribute to the PKI community.", ...requiredMembershipApplicationAnswers },
    };
    const first = await postJson(testEnv, "/api/v1/members/applications", payload);
    expect(first.status).toBe(201);
    expect(memberApplicationCreateResponseSchema.parse(await first.json()).stage).toBe("pending");

    const replay = await postJson(testEnv, "/api/v1/members/applications", payload);
    expect(replay.status).toBe(409);
    await expect(replay.json()).resolves.toMatchObject({ error: { code: "MEMBER_JOIN_CAPABILITY_USED" } });
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
      answers: { reason: "Apply through the verified canonical identity.", ...requiredMembershipApplicationAnswers },
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
        answers: { reason: "Race the verified account binding.", ...requiredMembershipApplicationAnswers },
        appBaseUrl: "https://app.test",
        joinCapabilityId: crypto.randomUUID(),
        applicantKind: "organization",
        applicantUserId: userId,
      }),
    ).rejects.toMatchObject({ status: 409, code: "MEMBER_JOIN_IDENTITY_CHANGED" });
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
