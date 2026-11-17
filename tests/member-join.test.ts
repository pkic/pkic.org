import { beforeEach, describe, expect, it } from "vitest";
import { DISPOSABLE_EMAIL_REFUSED, WORK_EMAIL_STEER } from "../assets/shared/email-first-copy";
import { env } from "cloudflare:workers";
import { apiValidationErrorDetailsSchema } from "../assets/shared/schemas/api-common";
import { memberJoinVerifyResponseSchema } from "../assets/shared/schemas/member-join";
import { identityAffiliationPreviewResponseSchema } from "../assets/shared/schemas/identity-affiliation";
import { memberApplicationCreateResponseSchema } from "../assets/shared/schemas/member-applications";
import { callApi } from "./helpers/app";
import { createTestRateLimiter, queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import {
  membershipApplicationDescriptionAnswers,
  requiredMembershipApplicationAnswers,
  seedMemberApplication,
  seedMembershipApplicationForm,
} from "./helpers/member-applications";
import { joinPath, signInJoinApplicant, type JoinApplicant } from "./helpers/member-join";
import { verifyMemberJoin } from "../functions/_lib/services/membership/join/verify";
import { verifyApplicationManageToken } from "../functions/_lib/services/membership/applications/queries";
import { prepareIndividualIdentityStatement } from "../functions/_lib/services/users";
import { nowIso } from "../functions/_lib/utils/time";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";

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

async function verifyJoin(testEnv: typeof env, applicant: JoinApplicant): Promise<Response> {
  const response = await joinPath(testEnv, applicant);
  const body = memberJoinVerifyResponseSchema.safeParse(await response.clone().json());
  if (body.success && body.data.status === "organization_selection_required" && body.data.organizations.length === 1)
    return joinPath(testEnv, applicant, { organizationId: body.data.organizations[0]!.id });
  return response;
}

/** The decision for an address the account has proved, as the route asks it for the primary one. */
function resolveMembershipPath(
  testEnv: typeof env,
  userId: string,
  email: string,
  applicantKind: "organization" | "individual" = "organization",
) {
  return verifyMemberJoin(testEnv.DB, {
    userId,
    email,
    applicantKind,
    signingSecret: testEnv.INTERNAL_SIGNING_SECRET!,
    applicationTtlSeconds: 900,
  });
}

describe("signed-in membership join", () => {
  beforeEach(async () => {
    await resetDb();
    await seedMembershipApplicationForm();
  });

  it("requires a signed-in person", async () => {
    const testEnv = makeEnv();
    const response = await postJson(testEnv, "/api/v1/members/join/verify", {});
    expect(response.status).toBe(401);
  });

  it("steers a personal address to a work address unless the individual capacity is attested", async () => {
    const testEnv = makeEnv();
    const response = await joinPath(testEnv, await signInJoinApplicant(testEnv, "person@gmail.com"));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(apiValidationErrorDetailsSchema.parse(body.error.details).fieldErrors).toEqual({
      email: [WORK_EMAIL_STEER],
    });

    const individual = await joinPath(testEnv, await signInJoinApplicant(testEnv, "person@gmail.com", true));
    expect(individual.status).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await individual.json())).toMatchObject({
      status: "application_ready",
      applicantKind: "individual",
    });
  });

  it("steers an ISP mailbox from the server's lists, and never accepts a disposable one", async () => {
    const testEnv = makeEnv();
    const steered = await joinPath(testEnv, await signInJoinApplicant(testEnv, "person@mail.ziggo.nl"));
    expect(steered.status).toBe(400);
    expect(JSON.stringify(await steered.json())).toContain(WORK_EMAIL_STEER);

    const disposable = await joinPath(testEnv, await signInJoinApplicant(testEnv, "person@mailinator.com", true));
    expect(disposable.status).toBe(400);
    expect(JSON.stringify(await disposable.json())).toContain(DISPOSABLE_EMAIL_REFUSED);
  });

  it("has an organization added as an identity before applying, and starts no session", async () => {
    const testEnv = makeEnv();
    const applicant = await signInJoinApplicant(testEnv, "applicant@unclaimed.example");
    const response = await verifyJoin(testEnv, applicant);

    expect(response.status).toBe(200);
    const body = memberJoinVerifyResponseSchema.parse(await response.json());
    // No continuation is issued for an organization: the person adds the identity that represents it.
    expect(body).toMatchObject({ status: "organization_selection_required", organizations: [] });
    expect(body).not.toHaveProperty("joinToken");
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toHaveLength(1);
  });

  it("continues only for an address the signed-in account has proved", async () => {
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
    const applicant = await signInJoinApplicant(testEnv, "primary@different.example");
    await testEnv.DB.prepare(
      `INSERT INTO user_emails (id, user_id, email, normalized_email, created_at)
       VALUES (?, ?, 'recipient@alias.example', 'recipient@alias.example', datetime('now'))`,
    )
      .bind(crypto.randomUUID(), applicant.userId)
      .run();
    const other = await signInJoinApplicant(testEnv, "someone@elsewhere.example");

    // Neither an address the account only reserved nor another account's address stands for the applicant.
    await expect(resolveMembershipPath(testEnv, applicant.userId, "recipient@alias.example")).resolves.toEqual({
      status: "support_required",
    });
    await expect(resolveMembershipPath(testEnv, other.userId, "primary@different.example")).resolves.toEqual({
      status: "support_required",
    });
    expect(await queryAll(testEnv.DB, "SELECT id FROM identities WHERE organization_id=?", [organizationId])).toEqual(
      [],
    );
  });

  it("binds a verified secondary work mailbox to the same person instead of their primary personal mailbox", async () => {
    const testEnv = makeEnv();
    const organizationId = await insertOrganization(testEnv.DB, "Secondary Work Organization");
    await seedOrganizationAggregate(testEnv.DB, organizationId, "A");
    await testEnv.DB.prepare(
      `INSERT INTO organization_domain_claims
         (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES (?, 'secondary-work.example', NULL, ?, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), organizationId)
      .run();
    const { userId } = await signInJoinApplicant(testEnv, "known-person@gmail.com");
    const emailId = crypto.randomUUID();
    const workEmail = "known-person@secondary-work.example";
    await testEnv.DB.prepare(
      `INSERT INTO user_emails
         (id,user_id,email,normalized_email,verified_at,verification_method,created_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'magic_link', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    )
      .bind(emailId, userId, workEmail, workEmail)
      .run();
    const result = await verifyMemberJoin(testEnv.DB, {
      userId,
      email: workEmail,
      applicantKind: "organization",
      organizationId,
      signingSecret: testEnv.INTERNAL_SIGNING_SECRET!,
      applicationTtlSeconds: 900,
    });
    expect(result).toMatchObject({ status: "organization_identity_ready" });
    expect(
      await queryAll(
        testEnv.DB,
        "SELECT user_id,email_id,organization_id FROM identities WHERE user_id=? AND organization_id IS NOT NULL",
        [userId],
      ),
    ).toEqual([{ user_id: userId, email_id: emailId, organization_id: organizationId }]);
    expect(await queryAll(testEnv.DB, "SELECT id,email FROM users WHERE id=?", [userId])).toEqual([
      { id: userId, email: "known-person@gmail.com" },
    ]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM users WHERE normalized_email=?", [workEmail])).toEqual([]);
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toEqual([]);
    await expect(resolveMembershipPath(testEnv, userId, workEmail)).resolves.toEqual({ status: "already_member" });
  });

  it.each([
    { saved: null, expected: { first_name: "Ada", last_name: "Lovelace" } },
    { saved: "Augusta", expected: { first_name: "Augusta", last_name: "Lovelace" } },
  ])("fills only the names the signed-in account lacks (saved first name $saved)", async ({ saved, expected }) => {
    const testEnv = makeEnv();
    const { userId } = await signInJoinApplicant(testEnv, "named-applicant@gmail.com", true);
    // Starting an account asks no names, so the join form's are the first the account hears of.
    await testEnv.DB.prepare("UPDATE users SET first_name=?, last_name=NULL WHERE id=?").bind(saved, userId).run();
    const verification = await resolveMembershipPath(testEnv, userId, "named-applicant@gmail.com", "individual");
    if (verification.status !== "application_ready") throw new Error("Expected application capability");

    const response = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: verification.applicantEmail,
      applicantName: "Ada Lovelace",
      membershipCategory: "H6",
      joinToken: verification.joinToken,
      answers: {
        reason: "Apply with a name the account does not hold yet.",
        ...requiredMembershipApplicationAnswers,
        ...membershipApplicationDescriptionAnswers("H6"),
      },
    });

    expect(response.status, await response.clone().text()).toBe(201);
    expect(
      await queryAll<{ first_name: string | null; last_name: string | null }>(
        testEnv.DB,
        "SELECT first_name, last_name FROM users WHERE id=?",
        [userId],
      ),
    ).toEqual([expected]);
  });

  it("finds an applicant's open application through another verified address on the same account", async () => {
    const testEnv = makeEnv();
    const { userId } = await signInJoinApplicant(testEnv, "jane@acmegrp.example.com");
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
      const verification = await resolveMembershipPath(testEnv, userId, alias);
      if (verification.status !== "application_in_progress") throw new Error(`Unexpected ${verification.status}`);
      expect(new URL(verification.statusPath, "https://app.test").searchParams.get("id")).toBe(applicationId);
    }
  });

  it("lets an existing nonmember attendee apply individually using the same canonical person", async () => {
    const testEnv = makeEnv();
    const email = "returning-attendee@unclaimed.example";
    const userId = await insertUser(env.DB, email);
    await env.DB.prepare("UPDATE users SET email_verified_at=? WHERE id=?").bind(nowIso(), userId).run();
    await env.DB.batch([prepareIndividualIdentityStatement(env.DB, userId, nowIso())]);
    const applicant = await signInJoinApplicant(testEnv, email, true);
    const response = await verifyJoin(testEnv, applicant);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await response.json()).status).toBe("application_ready");
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email=?", [email])).toEqual([{ id: userId }]);
  });

  it("adds the representation of an active claimed organization and continues the session as it", async () => {
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

    const applicant = await signInJoinApplicant(testEnv, "new-person@claimed.example");
    const choice = memberJoinVerifyResponseSchema.parse(await (await joinPath(testEnv, applicant)).json());
    expect(choice).toMatchObject({
      status: "organization_selection_required",
      domain: "claimed.example",
      organizations: [{ id: organizationId, name: "Claimed Organization" }],
    });
    const response = await verifyJoin(testEnv, applicant);

    expect(response.status).toBe(200);
    const body = memberJoinVerifyResponseSchema.parse(await response.json());
    expect(body).toEqual({ status: "organization_access_ready" });
    // The same session continues, now acting as the new representation.
    const [representation] = await queryAll<{ id: string }>(
      testEnv.DB,
      "SELECT id FROM identities WHERE user_id=? AND organization_id=?",
      [applicant.userId, organizationId],
    );
    const reissued = /pkic_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
    expect(JSON.parse(atob(reissued!.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")))).toMatchObject({
      sub: applicant.userId,
      iid: representation!.id,
    });
    expect(await queryAll(testEnv.DB, "SELECT id FROM sessions")).toHaveLength(1);
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

    const replay = await verifyJoin(testEnv, applicant);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({ status: "already_member" });
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
    const applicant = await signInJoinApplicant(testEnv, email);
    const racingDb = mutateBeforeMatchingQuery(
      testEnv.DB,
      (sql) => sql.includes("INSERT INTO identities"),
      () =>
        testEnv.DB.prepare("DELETE FROM organization_domain_claims WHERE organization_id=?").bind(organizationId).run(),
    );
    const response = await verifyJoin({ ...testEnv, DB: racingDb }, applicant);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "ORGANIZATION_AFFILIATION_CHANGED" } });
    expect(await queryAll(testEnv.DB, "SELECT id FROM identities WHERE organization_id=?", [organizationId])).toEqual(
      [],
    );
  });

  it("keeps the confirmed organization when a second organization claims the domain during verification", async () => {
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
    const applicant = await signInJoinApplicant(testEnv, "person@shared-race.example");
    const racingDb = mutateBeforeMatchingQuery(
      testEnv.DB,
      (sql) => sql.includes("INSERT INTO identities"),
      () =>
        testEnv.DB.prepare(
          `INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,(SELECT domain FROM organization_domain_claims WHERE id=?),?,?,?)`,
        )
          .bind(crypto.randomUUID(), claimId, second, at, at)
          .run(),
    );
    const result = await joinPath({ ...testEnv, DB: racingDb }, applicant, { organizationId: first });
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await result.json()).toEqual({ status: "organization_access_ready" });
    expect(
      await queryAll(
        testEnv.DB,
        "SELECT organization_id FROM identities WHERE user_id=? AND organization_id IS NOT NULL",
        [applicant.userId],
      ),
    ).toEqual([{ organization_id: first }]);
  });

  it("keeps the confirmed organization when another organization's person appears during verification", async () => {
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
    const applicant = await signInJoinApplicant(testEnv, "person@derived-race.example");
    const racingDb = mutateBeforeMatchingQuery(
      testEnv.DB,
      (sql) => sql.includes("INSERT INTO identities"),
      () =>
        testEnv.DB.prepare(`INSERT INTO identities(id,user_id,organization_id,verified_email_domain,source,invited_at,started_at,created_at,updated_at)
        VALUES (?,?,?,'derived-race.example','verified_email',?,?,?,?)`)
          .bind(crypto.randomUUID(), otherUser, second, at, at, at, at)
          .run(),
    );
    const result = await joinPath({ ...testEnv, DB: racingDb }, applicant, { organizationId: first });
    expect(result.status, await result.clone().text()).toBe(200);
    expect(await result.json()).toEqual({ status: "organization_access_ready" });
    expect(
      await queryAll(
        testEnv.DB,
        "SELECT organization_id FROM identities WHERE user_id=? AND organization_id IS NOT NULL",
        [applicant.userId],
      ),
    ).toEqual([{ organization_id: first }]);
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

    const applicant = await signInJoinApplicant(testEnv, "employee@policy.example", true);
    const response = await verifyJoin(testEnv, applicant);
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

    const applicant = await signInJoinApplicant(testEnv, "removed@blocked.example");
    const response = await verifyJoin(testEnv, applicant);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "support_required" });
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(0);
  });

  it("adds a parent member organization from a subdomain claimed by another organization", async () => {
    const testEnv = makeEnv();
    const parent = await insertOrganization(testEnv.DB, "Parent Member Org");
    await seedOrganizationAggregate(testEnv.DB, parent, "A");
    const department = await insertOrganization(testEnv.DB, "Department Member Org");
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,?,?,?,?)",
      ).bind(crypto.randomUUID(), "parent-member.example", parent, nowIso(), nowIso()),
      // The address's most specific claim belongs to another organization.
      testEnv.DB.prepare(
        "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,?,?,?,?)",
      ).bind(crypto.randomUUID(), "dept.parent-member.example", department, nowIso(), nowIso()),
    ]);
    const applicant = await signInJoinApplicant(testEnv, "person@dept.parent-member.example");
    // The parent domain is chosen while adding the identity; the join itself never picks a domain.
    const preview = (body: object) =>
      callApi(testEnv, "/api/v1/users/current/identities/preview", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: applicant.cookie },
        body: JSON.stringify({ email: "person@dept.parent-member.example", emailId: null, ...body }),
      });
    const resolved = await preview({ phase: "resolve", domain: "parent-member.example" });
    expect(resolved.status, await resolved.clone().text()).toBe(200);
    const prepared = identityAffiliationPreviewResponseSchema.parse(
      await (
        await preview({
          phase: "prepare",
          domain: "parent-member.example",
          organizationId: parent,
          jobTitle: "Engineer",
        })
      ).json(),
    );
    const created = await callApi(testEnv, "/api/v1/users/current/identities", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: applicant.cookie },
      body: JSON.stringify({ contextToken: prepared.contextToken }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    expect(
      await queryAll(
        testEnv.DB,
        "SELECT organization_id FROM identities WHERE organization_id IS NOT NULL AND ended_at IS NULL",
      ),
    ).toEqual([{ organization_id: parent }]);
    expect(memberJoinVerifyResponseSchema.parse(await (await joinPath(testEnv, applicant)).json())).toEqual({
      status: "already_member",
    });
  });

  it("tells an applicant about their open application before the form, with a working status link", async () => {
    const testEnv = makeEnv();
    const applicationId = await seedMemberApplication({
      applicantEmail: "jane@acmegrp.example.com",
      organizationDomain: "acmegrp.example.com",
      stage: "processing",
    });
    // The applicant's email challenge linked the organization to its domain; the application names it by id.
    const organizationId = await insertOrganization(testEnv.DB, "Example Org");
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,?,?,?,?)",
      ).bind(crypto.randomUUID(), "acmegrp.example.com", organizationId, nowIso(), nowIso()),
      testEnv.DB.prepare("UPDATE member_applications SET organization_id=? WHERE id=?").bind(
        organizationId,
        applicationId,
      ),
    ]);
    const verification = memberJoinVerifyResponseSchema.parse(
      await (await verifyJoin(testEnv, await signInJoinApplicant(testEnv, "jane@acmegrp.example.com"))).json(),
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

    // A colleague choosing the same organization learns that it already has an open application.
    const colleague = await signInJoinApplicant(testEnv, "omar@acmegrp.example.com");
    const sameOrganization = memberJoinVerifyResponseSchema.parse(
      await (await joinPath(testEnv, colleague, { organizationId })).json(),
    );
    expect(sameOrganization).toEqual({ status: "organization_application_in_progress" });

    // A closed application no longer stands in the way.
    await testEnv.DB.prepare("UPDATE member_applications SET stage = 'withdrawn' WHERE id = ?")
      .bind(applicationId)
      .run();
    const again = memberJoinVerifyResponseSchema.parse(
      await (await joinPath(testEnv, await signInJoinApplicant(testEnv, "jane@acmegrp.example.com"))).json(),
    );
    expect(again).toMatchObject({ status: "organization_selection_required" });
  });

  it("lets an individual apply at a domain held by another applicant's open organization application", async () => {
    const testEnv = makeEnv();
    await seedMemberApplication({
      applicantEmail: "owner@university.example",
      organizationDomain: "university.example",
      stage: "processing",
    });
    const applicant = await signInJoinApplicant(testEnv, "researcher@university.example", true);
    const response = await verifyJoin(testEnv, applicant);

    expect(response.status).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await response.json())).toMatchObject({
      status: "application_ready",
      applicantEmail: "researcher@university.example",
      applicantKind: "individual",
    });
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
      await (await verifyJoin(testEnv, await signInJoinApplicant(testEnv, "shared@acmegrp.example.com"))).json(),
    );
    expect(verification.status).toBe("organization_selection_required");
    expect(verification).not.toHaveProperty("statusPath");
  });

  it("binds one verified capability to one individual application and rejects replay", async () => {
    const testEnv = makeEnv();
    const applicant = await signInJoinApplicant(testEnv, "independent@gmail.com", true);
    const verification = memberJoinVerifyResponseSchema.parse(await (await verifyJoin(testEnv, applicant)).json());
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

  it("does not let a verified capability authorize a different mailbox or category kind", async () => {
    const testEnv = makeEnv();
    const applicant = await signInJoinApplicant(testEnv, "independent@organization.example", true);
    const verification = memberJoinVerifyResponseSchema.parse(await (await verifyJoin(testEnv, applicant)).json());
    if (verification.status !== "application_ready") throw new Error("Expected application capability");

    const wrongEmail = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: "attacker@organization.example",
      applicantName: "Wrong Address",
      membershipCategory: "H6",
      joinToken: verification.joinToken,
      answers: { reason: "Attempted capability substitution.", ...requiredMembershipApplicationAnswers },
    });
    expect(wrongEmail.status).toBe(401);

    const wrongKind = await postJson(testEnv, "/api/v1/members/applications", {
      applicantEmail: verification.applicantEmail,
      applicantName: "Wrong Kind",
      membershipCategory: "A",
      organizationName: "Organization",
      joinToken: verification.joinToken,
      answers: { reason: "Attempted category substitution.", ...requiredMembershipApplicationAnswers },
    });
    // An organization category is applied for only as the organization's identity.
    expect(wrongKind.status).toBe(409);
    await expect(wrongKind.json()).resolves.toMatchObject({ error: { code: "ORGANIZATION_IDENTITY_REQUIRED" } });
    expect(await queryAll(testEnv.DB, "SELECT id FROM member_applications")).toHaveLength(0);
  });
});
