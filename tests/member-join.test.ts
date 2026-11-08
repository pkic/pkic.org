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
  seedMemberApplication,
  seedMembershipApplicationForm,
} from "./helpers/member-applications";
import { materializeQueuedCapabilityLinks } from "../functions/_lib/auth/capability-links";
import {
  newMemberJoinCapabilityPayload,
  queuedMemberJoinVerificationToken,
} from "../functions/_lib/services/membership/join/capabilities";
import { verifyApplicationManageToken } from "../functions/_lib/services/membership/applications/queries";
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
  const response = await postJson(testEnv, "/api/v1/members/join/verify", { token }, budget);
  const body = memberJoinVerifyResponseSchema.safeParse(await response.clone().json());
  if (body.success && body.data.status === "organization_selection_required" && body.data.organizations.length === 1)
    return postJson(
      testEnv,
      "/api/v1/members/join/verify",
      { token, organizationId: body.data.organizations[0]!.id },
      budget,
    );
  return response;
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
    const choice = memberJoinVerifyResponseSchema.parse(
      await (await postJson(testEnv, "/api/v1/members/join/verify", { token })).json(),
    );
    expect(choice).toMatchObject({
      status: "organization_selection_required",
      domain: "claimed.example",
      organizations: [{ id: organizationId, name: "Claimed Organization" }],
    });
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toEqual([]);
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

  it.each(["first", "second"])(
    "asks which shared-domain organization to join and grants access to the %s",
    async (choice) => {
      const testEnv = makeEnv();
      const first = await insertOrganization(testEnv.DB, "First Organization");
      const second = await insertOrganization(testEnv.DB, "Second Organization");
      const firstMember = await seedOrganizationAggregate(testEnv.DB, first, "A");
      const secondMember = await seedOrganizationAggregate(testEnv.DB, second, "A");
      const claimId = crypto.randomUUID();
      const at = nowIso();
      await testEnv.DB.batch([
        testEnv.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
        VALUES (?,'shared-join.example',?,?,?)`).bind(claimId, first, at, at),
        testEnv.DB.prepare(
          `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
        ).bind(crypto.randomUUID(), claimId, second, at, at),
      ]);
      const token = await startAndMaterializeVerification(testEnv, "new-person@shared-join.example");
      const firstResponse = await verifyJoin(testEnv, token);
      const selection = memberJoinVerifyResponseSchema.parse(await firstResponse.json());
      expect(selection).toMatchObject({ status: "organization_selection_required", domain: "shared-join.example" });
      if (selection.status !== "organization_selection_required") throw new Error("Expected an organization choice");
      expect(selection.organizations.map((item) => item.id).sort()).toEqual([first, second].sort());
      expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toEqual([]);
      const unrelated = await insertOrganization(testEnv.DB, "Unrelated Organization");
      const forged = await postJson(testEnv, "/api/v1/members/join/verify", { token, organizationId: unrelated });
      expect(forged.status).toBe(409);
      expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toEqual([]);
      const selected = choice === "first" ? first : second;
      const response = await postJson(testEnv, "/api/v1/members/join/verify", { token, organizationId: selected });
      expect(response.status, await response.clone().text()).toBe(200);
      expect(memberJoinVerifyResponseSchema.parse(await response.json())).toMatchObject({
        status: "organization_access_ready",
        member: { memberId: choice === "first" ? firstMember : secondMember },
      });
      expect(
        await queryAll(
          testEnv.DB,
          `SELECT identity.organization_id FROM identities identity JOIN users person
      ON person.id=identity.user_id WHERE person.normalized_email=? AND identity.organization_id IS NOT NULL`,
          ["new-person@shared-join.example"],
        ),
      ).toEqual([{ organization_id: selected }]);
    },
  );

  it("lets a selected nonmember organization apply on a shared domain", async () => {
    const testEnv = makeEnv();
    const member = await insertOrganization(testEnv.DB, "Member Organization");
    const nonmember = await insertOrganization(testEnv.DB, "Nonmember Organization");
    await seedOrganizationAggregate(testEnv.DB, member, "A");
    const rootId = crypto.randomUUID();
    const at = nowIso();
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
        VALUES (?,'mixed-shared.example',?,?,?)`).bind(rootId, member, at, at),
      testEnv.DB.prepare(
        `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
      ).bind(crypto.randomUUID(), rootId, nonmember, at, at),
    ]);
    const token = await startAndMaterializeVerification(testEnv, "person@mixed-shared.example");
    const selection = memberJoinVerifyResponseSchema.parse(await (await verifyJoin(testEnv, token)).json());
    expect(selection.status).toBe("organization_selection_required");
    const response = await postJson(testEnv, "/api/v1/members/join/verify", { token, organizationId: nonmember });
    const continuation = memberJoinVerifyResponseSchema.parse(await response.json());
    expect(continuation).toMatchObject({ status: "application_ready", organizationName: "Nonmember Organization" });
    if (continuation.status !== "application_ready") throw new Error("Expected an application capability");
    const body = {
      applicantEmail: continuation.applicantEmail,
      applicantName: "Synthetic Applicant",
      membershipCategory: "F",
      organizationName: "Nonmember Organization",
      joinToken: continuation.joinToken,
      answers: {
        reason: "Apply for membership.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("F"),
      },
    };
    expect(
      (await postJson(testEnv, "/api/v1/members/applications", { ...body, organizationName: "Another Organization" }))
        .status,
    ).toBe(409);
    await testEnv.DB.prepare(
      "DELETE FROM organization_domain_claims WHERE domain=(SELECT domain FROM organization_domain_claims WHERE id=?) AND organization_id=?",
    )
      .bind(rootId, nonmember)
      .run();
    expect((await postJson(testEnv, "/api/v1/members/applications", body)).status).toBe(409);
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toEqual([]);
    await testEnv.DB.prepare(
      `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
    )
      .bind(crypto.randomUUID(), rootId, nonmember, at, at)
      .run();
    const refreshed = memberJoinVerifyResponseSchema.parse(
      await (await postJson(testEnv, "/api/v1/members/join/verify", { token, organizationId: nonmember })).json(),
    );
    if (refreshed.status !== "application_ready") throw new Error(`Unexpected ${refreshed.status}`);
    const application = await postJson(testEnv, "/api/v1/members/applications", {
      ...body,
      joinToken: refreshed.joinToken,
    });
    expect(application.status, await application.clone().text()).toBe(201);
    expect(
      await queryAll(
        testEnv.DB,
        "SELECT organization_id,organization_name,organization_domain FROM member_applications",
      ),
    ).toEqual([
      {
        organization_id: nonmember,
        organization_name: "Nonmember Organization",
        organization_domain: "mixed-shared.example",
      },
    ]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toEqual([]);
  });

  it.each(["shared-create.example", "division.shared-create.example"])(
    "holds the selected domain %s for the new application until approval",
    async (domain) => {
      const testEnv = makeEnv();
      const member = await insertOrganization(testEnv.DB, "Existing Member");
      await seedOrganizationAggregate(testEnv.DB, member, "A");
      const at = nowIso();
      await testEnv.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
        VALUES (?,'shared-create.example',?,?,?)`)
        .bind(crypto.randomUUID(), member, at, at)
        .run();
      const token = await startAndMaterializeVerification(testEnv, "person@division.shared-create.example");
      const initial = memberJoinVerifyResponseSchema.parse(
        await (await postJson(testEnv, "/api/v1/members/join/verify", { token })).json(),
      );
      expect(initial.status).toBe("organization_selection_required");
      const choice = memberJoinVerifyResponseSchema.parse(
        await (await postJson(testEnv, "/api/v1/members/join/verify", { token, domain })).json(),
      );
      expect(choice.status).toBe("organization_selection_required");
      const result = await postJson(testEnv, "/api/v1/members/join/verify", {
        token,
        domain,
        organizationName: "New Organization",
      });
      expect(result.status, await result.clone().text()).toBe(200);
      const continuation = memberJoinVerifyResponseSchema.parse(await result.json());
      if (continuation.status !== "application_ready") throw new Error(`Unexpected ${continuation.status}`);
      const application = await postJson(testEnv, "/api/v1/members/applications", {
        applicantEmail: continuation.applicantEmail,
        applicantName: "Synthetic Applicant",
        membershipCategory: "F",
        organizationName: "New Organization",
        joinToken: continuation.joinToken,
        answers: {
          reason: "Apply for membership.",
          ...requiredMembershipApplicationAnswers,
          ...membershipApplicationDescriptionAnswers("F"),
        },
      });
      expect(application.status, await application.clone().text()).toBe(201);
      expect(
        await queryAll(
          testEnv.DB,
          `SELECT organization.name FROM organization_domain_claims claim
        JOIN organizations organization ON organization.id=claim.organization_id WHERE claim.domain=? ORDER BY organization.name`,
          [domain],
        ),
      ).toEqual(domain === "shared-create.example" ? [{ name: "Existing Member" }] : []);
    },
  );

  it("asks a new organization to choose between an unclaimed parent domain and subdomain", async () => {
    const testEnv = makeEnv();
    const email = "person@division.unclaimed-company.example";
    const token = await startAndMaterializeVerification(testEnv, email);
    const response = memberJoinVerifyResponseSchema.parse(
      await (await postJson(testEnv, "/api/v1/members/join/verify", { token })).json(),
    );
    if (response.status !== "organization_selection_required") throw new Error(`Unexpected ${response.status}`);
    expect(response.organizations).toEqual([]);
    expect(response.affiliation.domains.map((item) => item.domain)).toEqual(
      expect.arrayContaining(["unclaimed-company.example", "division.unclaimed-company.example"]),
    );
    const confirmed = memberJoinVerifyResponseSchema.parse(
      await (
        await postJson(testEnv, "/api/v1/members/join/verify", {
          token,
          organizationName: "New Division",
          domain: "division.unclaimed-company.example",
        })
      ).json(),
    );
    if (confirmed.status !== "application_ready") throw new Error(`Unexpected ${confirmed.status}`);
    const application = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: email,
      applicantName: "Synthetic Applicant",
      membershipCategory: "F",
      organizationName: "New Division",
      joinToken: confirmed.joinToken,
      answers: {
        reason: "Apply for membership.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("F"),
      },
    });
    expect(application.status, await application.clone().text()).toBe(201);
    expect(
      await queryAll(
        testEnv.DB,
        `SELECT organization.name FROM organization_domain_claims claim
      JOIN organizations organization ON organization.id=claim.organization_id WHERE claim.domain=?`,
        ["division.unclaimed-company.example"],
      ),
    ).toEqual([]);
  });

  it("rolls back a new organization when the chosen domain changes before application submission", async () => {
    const testEnv = makeEnv();
    const member = await insertOrganization(testEnv.DB, "Existing Member");
    const newcomer = await insertOrganization(testEnv.DB, "Concurrent Organization");
    await seedOrganizationAggregate(testEnv.DB, member, "A");
    const claimId = crypto.randomUUID();
    const at = nowIso();
    await testEnv.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
      VALUES (?,'race-create.example',?,?,?)`)
      .bind(claimId, member, at, at)
      .run();
    const token = await startAndMaterializeVerification(testEnv, "person@race-create.example");
    const response = await postJson(testEnv, "/api/v1/members/join/verify", {
      token,
      domain: "race-create.example",
      organizationName: "New Organization",
    });
    const continuation = memberJoinVerifyResponseSchema.parse(await response.json());
    if (continuation.status !== "application_ready") throw new Error(`Unexpected ${continuation.status}`);
    await testEnv.DB.prepare(
      `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
    )
      .bind(crypto.randomUUID(), claimId, newcomer, at, at)
      .run();
    const application = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: continuation.applicantEmail,
      applicantName: "Synthetic Applicant",
      membershipCategory: "F",
      organizationName: "New Organization",
      joinToken: continuation.joinToken,
      answers: {
        reason: "Apply for membership.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("F"),
      },
    });
    expect(application.status).toBe(409);
    expect(await queryAll(testEnv.DB, "SELECT id FROM organizations WHERE name=?", ["New Organization"])).toEqual([]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toEqual([]);
  });

  it("asks for a choice when another organization is known from a verified affiliation", async () => {
    const testEnv = makeEnv();
    const member = await insertOrganization(testEnv.DB, "Member Organization");
    const other = await insertOrganization(testEnv.DB, "Other Organization");
    await seedOrganizationAggregate(testEnv.DB, member, "A");
    const at = nowIso();
    const otherUser = await insertUser(testEnv.DB, "other@derived-shared.example");
    await testEnv.DB.batch([
      testEnv.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
        VALUES (?,'derived-shared.example',?,?,?)`).bind(crypto.randomUUID(), member, at, at),
      testEnv.DB.prepare(`INSERT INTO identities(id,user_id,organization_id,verified_email_domain,source,invited_at,started_at,created_at,updated_at)
        VALUES (?,?,?,'derived-shared.example','verified_email',?,?,?,?)`).bind(
        crypto.randomUUID(),
        otherUser,
        other,
        at,
        at,
        at,
        at,
      ),
    ]);
    const token = await startAndMaterializeVerification(testEnv, "person@derived-shared.example");
    const selection = memberJoinVerifyResponseSchema.parse(await (await verifyJoin(testEnv, token)).json());
    expect(selection.status).toBe("organization_selection_required");
    if (selection.status !== "organization_selection_required") throw new Error("Expected an organization choice");
    expect(selection.organizations.map((item) => item.id).sort()).toEqual([member, other].sort());
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toEqual([]);
    const selected = memberJoinVerifyResponseSchema.parse(
      await (await postJson(testEnv, "/api/v1/members/join/verify", { token, organizationId: other })).json(),
    );
    if (selected.status !== "application_ready") throw new Error(`Unexpected ${selected.status}`);
    const application = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: selected.applicantEmail,
      applicantName: "Synthetic Applicant",
      membershipCategory: "F",
      organizationName: "Other Organization",
      joinToken: selected.joinToken,
      answers: {
        reason: "Apply for membership.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("F"),
      },
    });
    expect(application.status, await application.clone().text()).toBe(201);
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

  it("does not grant membership when a second organization claims the domain during verification", async () => {
    const testEnv = makeEnv();
    const first = await insertOrganization(testEnv.DB, "First Organization");
    const second = await insertOrganization(testEnv.DB, "Second Organization");
    await seedOrganizationAggregate(testEnv.DB, first, "A");
    await seedOrganizationAggregate(testEnv.DB, second, "A");
    const claimId = crypto.randomUUID();
    const at = nowIso();
    await testEnv.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
      VALUES (?,'shared-race.example',?,?,?)`)
      .bind(claimId, first, at, at)
      .run();
    const token = await startAndMaterializeVerification(testEnv, "person@shared-race.example");
    const racingDb = mutateBeforeMatchingQuery(
      testEnv.DB,
      (sql) => sql.includes("INSERT INTO users"),
      () =>
        testEnv.DB.prepare(
          `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
        )
          .bind(crypto.randomUUID(), claimId, second, at, at)
          .run(),
    );
    const result = await verifyJoin({ ...testEnv, DB: racingDb }, token);
    expect(result.status).toBe(409);
    expect(
      await queryAll(testEnv.DB, "SELECT id FROM users WHERE normalized_email=?", ["person@shared-race.example"]),
    ).toEqual([]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toEqual([]);
    const retry = memberJoinVerifyResponseSchema.parse(await (await verifyJoin(testEnv, token)).json());
    expect(retry.status).toBe("organization_selection_required");
  });

  it("honors an explicit member choice if another verified affiliation appears during verification", async () => {
    const testEnv = makeEnv();
    const first = await insertOrganization(testEnv.DB, "First Organization");
    const second = await insertOrganization(testEnv.DB, "Second Organization");
    await seedOrganizationAggregate(testEnv.DB, first, "A");
    const otherUser = await insertUser(testEnv.DB, "other@derived-race.example");
    const at = nowIso();
    await testEnv.DB.prepare(`INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at)
      VALUES (?,'derived-race.example',?,?,?)`)
      .bind(crypto.randomUUID(), first, at, at)
      .run();
    const token = await startAndMaterializeVerification(testEnv, "person@derived-race.example");
    const racingDb = mutateBeforeMatchingQuery(
      testEnv.DB,
      (sql) => sql.includes("INSERT INTO users"),
      () =>
        testEnv.DB.prepare(`INSERT INTO identities(id,user_id,organization_id,verified_email_domain,source,invited_at,started_at,created_at,updated_at)
        VALUES (?,?,?,'derived-race.example','verified_email',?,?,?,?)`)
          .bind(crypto.randomUUID(), otherUser, second, at, at, at, at)
          .run(),
    );
    const result = await verifyJoin({ ...testEnv, DB: racingDb }, token);
    expect(result.status, await result.clone().text()).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await result.json()).status).toBe("organization_access_ready");
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toHaveLength(1);
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

  it("tells an applicant about their open application before the form, with a working status link", async () => {
    const testEnv = makeEnv();
    const applicationId = await seedMemberApplication({
      applicantEmail: "jane@acmegrp.example.com",
      organizationDomain: "acmegrp.example.com",
      stage: "processing",
    });
    const verification = memberJoinVerifyResponseSchema.parse(
      await (
        await verifyJoin(testEnv, await startAndMaterializeVerification(testEnv, "jane@acmegrp.example.com"), {
          maxRoundTrips: 1,
        })
      ).json(),
    );
    if (verification.status !== "application_in_progress") throw new Error(`Unexpected ${verification.status}`);
    const statusLink = new URL(verification.statusPath, "https://app.test");
    expect(statusLink.searchParams.get("id")).toBe(applicationId);
    const status = await callApi(
      testEnv,
      `/api/v1/members/applications/${applicationId}/status?token=${encodeURIComponent(statusLink.searchParams.get("token")!)}`,
    );
    expect(status.status).toBe(200);
    const documents = await callApi(
      testEnv,
      `/api/v1/members/applications/${applicationId}/documents?token=${encodeURIComponent(statusLink.searchParams.get("token")!)}`,
    );
    expect(documents.status).toBe(400);
    await expect(
      verifyApplicationManageToken(testEnv.DB, applicationId, statusLink.searchParams.get("token")!),
    ).resolves.toBeNull();

    // A colleague can choose another organization, while the pending organization keeps its application.
    const colleagueToken = await startAndMaterializeVerification(testEnv, "omar@acmegrp.example.com");
    const colleague = memberJoinVerifyResponseSchema.parse(
      await (await postJson(testEnv, "/api/v1/members/join/verify", { token: colleagueToken })).json(),
    );
    expect(colleague.status).toBe("organization_selection_required");
    const sameOrganization = memberJoinVerifyResponseSchema.parse(
      await (
        await postJson(testEnv, "/api/v1/members/join/verify", {
          token: colleagueToken,
          domain: "acmegrp.example.com",
          organizationName: "Example Org",
        })
      ).json(),
    );
    expect(sameOrganization).toEqual({ status: "organization_application_in_progress" });

    // A closed application no longer stands in the way.
    await testEnv.DB.prepare("UPDATE member_applications SET stage = 'withdrawn' WHERE id = ?")
      .bind(applicationId)
      .run();
    await testEnv.DB.prepare("DELETE FROM organization_domain_claims WHERE application_id = ?")
      .bind(applicationId)
      .run();
    const again = memberJoinVerifyResponseSchema.parse(
      await (
        await verifyJoin(testEnv, await startAndMaterializeVerification(testEnv, "jane@acmegrp.example.com"), {
          maxRoundTrips: 1,
        })
      ).json(),
    );
    expect(again.status).toBe("organization_selection_required");
  });

  it("lets another organization apply on a domain with a pending application", async () => {
    const testEnv = makeEnv();
    const pending = await seedMemberApplication({
      applicantEmail: "owner@pending-shared.example",
      organizationName: "Pending Organization",
      organizationDomain: "pending-shared.example",
      stage: "processing",
    });
    const token = await startAndMaterializeVerification(testEnv, "person@pending-shared.example");
    const selection = memberJoinVerifyResponseSchema.parse(
      await (await postJson(testEnv, "/api/v1/members/join/verify", { token })).json(),
    );
    expect(selection.status).toBe("organization_selection_required");
    const ready = memberJoinVerifyResponseSchema.parse(
      await (
        await postJson(testEnv, "/api/v1/members/join/verify", {
          token,
          domain: "pending-shared.example",
          organizationName: "Different Organization",
        })
      ).json(),
    );
    if (ready.status !== "application_ready") throw new Error(`Unexpected ${ready.status}`);
    const submitted = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: ready.applicantEmail,
      applicantName: "Synthetic Applicant",
      membershipCategory: "F",
      organizationName: "Different Organization",
      joinToken: ready.joinToken,
      answers: {
        reason: "Apply for membership.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("F"),
      },
    });
    expect(submitted.status, await submitted.clone().text()).toBe(201);
    expect(
      await queryAll(
        testEnv.DB,
        "SELECT application_id FROM organization_domain_claims WHERE domain=? AND application_id IS NOT NULL",
        ["pending-shared.example"],
      ),
    ).toEqual(expect.arrayContaining([{ application_id: pending }, { application_id: expect.any(String) }]));
    expect(
      await queryAll(testEnv.DB, "SELECT application_id FROM organization_domain_claims WHERE domain=?", [
        "pending-shared.example",
      ]),
    ).toHaveLength(2);
    expect(await queryAll(testEnv.DB, "SELECT id FROM organizations WHERE name=?", ["Different Organization"])).toEqual(
      [],
    );
  });

  it("lets a person choose an existing member while another application uses the domain", async () => {
    const testEnv = makeEnv();
    const pending = await seedMemberApplication({
      applicantEmail: "owner@pending-member.example",
      organizationName: "Pending Organization",
      organizationDomain: "pending-member.example",
      stage: "processing",
    });
    const member = await insertOrganization(testEnv.DB, "Existing Member");
    const memberId = await seedOrganizationAggregate(testEnv.DB, member, "A");
    const root = await testEnv.DB.prepare("SELECT id FROM organization_domain_claims WHERE application_id=?")
      .bind(pending)
      .first<string>("id");
    const at = nowIso();
    await testEnv.DB.prepare(
      `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
    )
      .bind(crypto.randomUUID(), root, member, at, at)
      .run();
    const token = await startAndMaterializeVerification(testEnv, "person@pending-member.example");
    const first = memberJoinVerifyResponseSchema.parse(
      await (await postJson(testEnv, "/api/v1/members/join/verify", { token })).json(),
    );
    expect(first).toMatchObject({ status: "organization_selection_required", organizations: [{ id: member }] });
    const response = await postJson(testEnv, "/api/v1/members/join/verify", { token, organizationId: member });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await response.json())).toMatchObject({
      status: "organization_access_ready",
      member: { memberId },
    });
  });

  it("does not create an application when another account claims the verified email before the atomic write", async () => {
    const testEnv = makeEnv();
    const email = "person@ownership-race.example";
    const token = await startAndMaterializeVerification(testEnv, email);
    const ready = memberJoinVerifyResponseSchema.parse(await (await verifyJoin(testEnv, token)).json());
    if (ready.status !== "application_ready") throw new Error(`Unexpected ${ready.status}`);
    const racingDb = mutateBeforeMatchingQuery(
      testEnv.DB,
      (sql) => sql.includes("INSERT INTO users"),
      () => insertUser(testEnv.DB, email),
    );
    const response = await postJson({ ...testEnv, DB: racingDb }, "/api/v1/members/applications", {
      applicantEmail: email,
      applicantName: "Synthetic Applicant",
      membershipCategory: "F",
      organizationName: "Ownership Race Organization",
      joinToken: ready.joinToken,
      answers: {
        reason: "Apply for membership.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("F"),
      },
    });
    expect(response.status).toBe(409);
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications WHERE applicant_email=?", [email])).toEqual(
      [],
    );
  });

  it("rejects a new membership application when a pending organization changes after selection", async () => {
    const testEnv = makeEnv();
    const pending = await seedMemberApplication({
      applicantEmail: "owner@pending-race.example",
      organizationDomain: "pending-race.example",
      organizationName: "Pending Organization",
    });
    const token = await startAndMaterializeVerification(testEnv, "person@pending-race.example");
    const ready = memberJoinVerifyResponseSchema.parse(
      await (
        await postJson(testEnv, "/api/v1/members/join/verify", {
          token,
          domain: "pending-race.example",
          organizationName: "Different Organization",
        })
      ).json(),
    );
    if (ready.status !== "application_ready") throw new Error(`Unexpected ${ready.status}`);
    const racingDb = mutateBeforeMatchingQuery(
      testEnv.DB,
      (sql) => sql.includes("INSERT INTO users"),
      () =>
        testEnv.DB.prepare("UPDATE member_applications SET organization_name=?,updated_at=? WHERE id=?")
          .bind("Different Organization", "2099-01-01T00:00:00.000Z", pending)
          .run(),
    );
    const response = await postJson({ ...testEnv, DB: racingDb }, "/api/v1/members/applications", {
      applicantEmail: ready.applicantEmail,
      applicantName: "Synthetic Applicant",
      membershipCategory: "F",
      organizationName: "Different Organization",
      joinToken: ready.joinToken,
      answers: {
        reason: "Apply for membership.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("F"),
      },
    });
    expect(response.status).toBe(409);
    expect(await queryAll(testEnv.DB, "SELECT id FROM organizations WHERE name=?", ["Different Organization"])).toEqual(
      [],
    );
  });

  it("lets an individual apply at a domain held by another applicant's open organization application", async () => {
    const testEnv = makeEnv();
    await seedMemberApplication({
      applicantEmail: "owner@university.example",
      organizationDomain: "university.example",
      stage: "processing",
    });
    const token = await startAndMaterializeVerification(testEnv, "researcher@university.example", true);
    const response = await verifyJoin(testEnv, token, { maxRoundTrips: 1 });

    expect(response.status).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await response.json())).toMatchObject({
      status: "application_ready",
      applicantEmail: "researcher@university.example",
      applicantKind: "individual",
    });
  });

  it("finds an applicant's open application through another verified address on the same account", async () => {
    const testEnv = makeEnv();
    const userId = await insertUser(testEnv.DB, "jane@acmegrp.example.com");
    const applicationId = await seedMemberApplication({
      applicantUserId: userId,
      applicantEmail: "jane@acmegrp.example.com",
      organizationDomain: "acmegrp.example.com",
      stage: "processing",
    });
    for (const alias of ["j.doe@acmegrp.example.com", "jane@acme-labs.example.com"]) {
      await testEnv.DB.prepare(
        `INSERT INTO user_emails
           (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
         VALUES (?, ?, ?, ?, datetime('now'), 'staff', datetime('now'))`,
      )
        .bind(crypto.randomUUID(), userId, alias, alias)
        .run();
      const verification = memberJoinVerifyResponseSchema.parse(
        await (await verifyJoin(testEnv, await startAndMaterializeVerification(testEnv, alias))).json(),
      );
      if (verification.status !== "application_in_progress") throw new Error(`Unexpected ${verification.status}`);
      expect(new URL(verification.statusPath, "https://app.test").searchParams.get("id")).toBe(applicationId);
    }
  });

  it("does not hand one account's application to an address that account no longer holds", async () => {
    const testEnv = makeEnv();
    const formerHolder = await insertUser(testEnv.DB, "former@elsewhere.example.com");
    await seedMemberApplication({
      applicantUserId: formerHolder,
      applicantEmail: "shared@acmegrp.example.com",
      organizationDomain: "acmegrp.example.com",
      stage: "processing",
    });
    const verification = memberJoinVerifyResponseSchema.parse(
      await (
        await verifyJoin(testEnv, await startAndMaterializeVerification(testEnv, "shared@acmegrp.example.com"))
      ).json(),
    );
    expect(verification.status).toBe("organization_selection_required");
    expect(verification).not.toHaveProperty("statusPath");
  });

  it("does not reveal an account's application through an unverified alias reservation", async () => {
    const testEnv = makeEnv();
    const userId = await insertUser(testEnv.DB, "owner@reserved-account.example");
    await seedMemberApplication({
      applicantUserId: userId,
      applicantEmail: "owner@reserved-account.example",
      organizationDomain: "reserved-account.example",
      stage: "processing",
    });
    const alias = "reserved@separate.example";
    await testEnv.DB.prepare(
      "INSERT INTO user_emails (id,user_id,email,normalized_email,created_at) VALUES (?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), userId, alias, alias, nowIso())
      .run();
    const verified = await verifyJoin(testEnv, await startAndMaterializeVerification(testEnv, alias), {
      maxRoundTrips: 1,
    });
    expect(verified.status).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await verified.json()).status).toBe("application_ready");
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
