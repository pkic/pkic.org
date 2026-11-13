import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { memberJoinVerifyResponseSchema } from "../assets/shared/schemas/member-join";
import { memberApplicationCreateResponseSchema } from "../assets/shared/schemas/member-applications";
import { buildApplicationApproval } from "../functions/_lib/services/membership/applications/provision-application";
import { getMemberApplicationById } from "../functions/_lib/services/membership/applications/queries";
import { transitionApplicationStage } from "../functions/_lib/services/membership/applications/transition";
import { createMemberApplication } from "../functions/_lib/services/membership/applications/create";
import { domainClaimsObservationFingerprint } from "../functions/_lib/services/identities/affiliation-evidence";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createTestRateLimiter, queryAll } from "./helpers/context";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import {
  membershipApplicationDescriptionAnswers,
  requiredMembershipApplicationAnswers,
  seedMembershipApplicationForm,
  verifiedMemberApplicationPayload,
} from "./helpers/member-applications";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { joinPath, signInJoinApplicant, type JoinApplicant } from "./helpers/member-join";
import { resetDb } from "./helpers/reset-db";

const testEnv = {
  ...env,
  IP_RATE_LIMITER: createTestRateLimiter(100),
  EMAIL_RATE_LIMITER: createTestRateLimiter(100),
} as typeof env;
const domain = "review-work.example";
const answers = {
  reason: "Contribute to PKI standards.",
  ...requiredMembershipApplicationAnswers,
  ...membershipApplicationDescriptionAnswers("F"),
};
function post(path: string, body: unknown) {
  return callApi(testEnv, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
/** The signed-in applicant at the reviewed domain, joining for an organization or as an individual. */
function applicant(kind: "organization" | "individual" = "organization", email = `applicant@${domain}`) {
  return signInJoinApplicant(testEnv, email, kind === "individual");
}
async function claim(organizationId: string) {
  await env.DB.prepare(
    "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,?,?,?,?)",
  )
    .bind(crypto.randomUUID(), domain, organizationId, nowIso(), nowIso())
    .run();
}
async function derived(organizationId: string, blocked = false) {
  const userId = await insertUser(env.DB, `colleague@${domain}`);
  const at = nowIso();
  await env.DB.prepare(`INSERT INTO identities(id,user_id,organization_id,verified_email_domain,source,started_at,ended_at,blocked_at,invited_at,created_at,updated_at)
    VALUES (?,?,?,?,'verified_email',?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), userId, organizationId, domain, at, blocked ? at : null, blocked ? at : null, at, at, at)
    .run();
}
async function apply(selection: { organizationId?: string; organizationName?: string }, person?: JoinApplicant) {
  const response = await joinPath(testEnv, person ?? (await applicant()), { domain, ...selection });
  expect(response.status, await response.clone().text()).toBe(200);
  const continuation = memberJoinVerifyResponseSchema.parse(await response.json());
  if (continuation.status !== "application_ready")
    throw new Error(`Expected application, received ${continuation.status}`);
  const submitted = await post("/api/v1/members/applications", {
    applicantEmail: continuation.applicantEmail,
    applicantName: "Review Applicant",
    membershipCategory: "F",
    organizationName: continuation.organizationName,
    joinToken: continuation.joinToken,
    answers,
  });
  expect(submitted.status, await submitted.clone().text()).toBe(201);
  return memberApplicationCreateResponseSchema.parse(await submitted.json()).applicationId;
}
async function approve(id: string) {
  const application = await getMemberApplicationById(env.DB, id);
  if (!application) throw new Error("Missing application");
  const plan = await buildApplicationApproval(env.DB, application, {
    actor: null,
    loginUrl: "https://app.test/login/",
  });
  await env.DB.batch(plan.statements);
  return plan.result;
}

beforeEach(async () => {
  await resetDb();
  await seedMembershipApplicationForm();
});
describe("membership domain claim lifecycle", () => {
  it.each(["claimed", "derived", "ambiguous"])(
    "lets an individual continue past a %s nonmember domain without choosing an organization",
    async (kind) => {
      const first = await insertOrganization(env.DB, "First Nonmember");
      if (kind === "claimed") await claim(first);
      else await derived(first);
      if (kind === "ambiguous") await claim(await insertOrganization(env.DB, "Second Nonmember"));
      const response = await joinPath(testEnv, await applicant("individual"));
      expect(response.status, await response.clone().text()).toBe(200);
      const continuation = memberJoinVerifyResponseSchema.parse(await response.json());
      expect(continuation).toMatchObject({ status: "application_ready", applicantKind: "individual" });
      if (continuation.status !== "application_ready") throw new Error("Expected individual application");
      const submitted = await post("/api/v1/members/applications", {
        applicantEmail: continuation.applicantEmail,
        applicantName: "Independent Applicant",
        membershipCategory: "H6",
        joinToken: continuation.joinToken,
        answers: {
          reason: answers.reason,
          ...requiredMembershipApplicationAnswers,
          ...membershipApplicationDescriptionAnswers("H6"),
        },
      });
      expect(submitted.status, await submitted.clone().text()).toBe(201);
    },
  );

  it("previews a subdomain for the signed-in account's address without changing anything", async () => {
    const member = await insertOrganization(env.DB, "Preview Member");
    await seedOrganizationAggregate(env.DB, member);
    await claim(member);
    const person = await applicant("individual", `applicant@eu.${domain}`);
    const preview = await callApi(testEnv, "/api/v1/members/join/affiliations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: person.cookie },
      body: JSON.stringify({ domain: `eu.${domain}` }),
    });
    expect(preview.status, await preview.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE organization_id IS NOT NULL")).toEqual([]);
    const chooser = await joinPath(testEnv, person);
    expect(await chooser.json()).toMatchObject({
      status: "organization_selection_required",
      canApplyAsIndividual: true,
    });
    const continued = await joinPath(testEnv, person, { continueAsIndividual: true });
    expect(await continued.json()).toMatchObject({ status: "application_ready", applicantKind: "individual" });
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE organization_id IS NOT NULL")).toEqual([]);
    const joined = await joinPath(testEnv, person, { organizationId: member });
    expect(joined.status, await joined.clone().text()).toBe(200);
    expect(await joined.json()).toEqual({ status: "organization_access_ready" });
    // Once the person represents the member, the path says so instead of offering the choice again.
    expect(await (await joinPath(testEnv, person)).json()).toEqual({ status: "already_member" });
  });

  it("lets an individual apply on a lapsed member's domain", async () => {
    const member = await insertOrganization(env.DB, "Lapsed Member");
    await seedOrganizationAggregate(env.DB, member);
    await claim(member);
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE organization_id=?").bind(member).run();
    const response = await joinPath(testEnv, await applicant("individual"));
    expect(await response.json()).toMatchObject({ status: "application_ready", applicantKind: "individual" });
  });

  it.each(["ended", "blocked"])(
    "approves the durable organization selection after its derived evidence is %s",
    async (state) => {
      const selected = await insertOrganization(env.DB, "Selected Organization");
      await derived(selected);
      const id = await apply({ organizationId: selected });
      await env.DB.prepare("UPDATE identities SET ended_at=?,blocked_at=? WHERE organization_id=?")
        .bind(nowIso(), state === "blocked" ? nowIso() : null, selected)
        .run();
      expect((await approve(id)).organizationId).toBe(selected);
    },
  );

  it.each([false, true])("requires the reused approved claim to survive review (released: %s)", async (released) => {
    const selected = await insertOrganization(env.DB, "Claimed Applicant");
    await claim(selected);
    const id = await apply({ organizationId: selected });
    expect(
      await queryAll(env.DB, "SELECT application_id,organization_id FROM organization_domain_claims WHERE domain=?", [
        domain,
      ]),
    ).toEqual([{ application_id: null, organization_id: selected }]);
    if (released)
      await env.DB.prepare("DELETE FROM organization_domain_claims WHERE organization_id=?").bind(selected).run();
    if (released) {
      await expect(approve(id)).rejects.toMatchObject({
        status: 409,
        code: "DOMAIN_CLAIM_LOST",
        message: `Claimed Applicant no longer has the email domain ${domain}. Add it under Email domains, or correct the application's organization before approving.`,
      });
      expect(await queryAll(env.DB, "SELECT id FROM members WHERE organization_id=?", [selected])).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM organization_domain_claims WHERE domain=?", [domain])).toEqual([]);
    } else expect((await approve(id)).organizationId).toBe(selected);
  });

  it("names the proposed organization and domain when its provisional claim is lost", async () => {
    const id = await apply({ organizationName: "Proposed Organization" });
    await env.DB.prepare("DELETE FROM organization_domain_claims WHERE application_id=?").bind(id).run();
    await expect(approve(id)).rejects.toMatchObject({
      code: "DOMAIN_CLAIM_LOST",
      message: `Proposed Organization no longer has the email domain ${domain}. Correct and save the application's organization name to claim the domain again before approving.`,
    });
    expect(await queryAll(env.DB, "SELECT id FROM organizations WHERE name='Proposed Organization'")).toEqual([]);
  });

  it("refuses a new subdomain claim appearing between verification and submission", async () => {
    const email = `applicant@eu.${domain}`;
    const payload = await verifiedMemberApplicationPayload({
      applicantEmail: email,
      applicantName: "Review Applicant",
      membershipCategory: "F",
      organizationName: "New Organization",
      answers,
    });
    const other = await insertOrganization(env.DB, "Subdomain Claimant");
    const racingDb = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO member_applications"),
      () =>
        env.DB.prepare(
          "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,?,?,?,?)",
        )
          .bind(crypto.randomUUID(), `eu.${domain}`, other, nowIso(), nowIso())
          .run(),
    );
    const submitted = await callApi({ ...testEnv, DB: racingDb }, "/api/v1/members/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(submitted.status).toBe(409);
    expect(await submitted.json()).toMatchObject({ error: { code: "ORGANIZATION_AFFILIATION_CHANGED" } });
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM form_submissions")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email=?", [email])).toEqual([]);
  });

  it("returns a review refusal when claims overflow after the organization was chosen", async () => {
    const selected = await insertOrganization(env.DB, "Chosen Organization");
    await claim(selected);
    const verified = await joinPath(testEnv, await applicant(), { organizationId: selected });
    const continuation = memberJoinVerifyResponseSchema.parse(await verified.json());
    if (continuation.status !== "application_ready") throw new Error("Expected application");
    for (let index = 0; index < 128; index++) await claim(await insertOrganization(env.DB, `Other Claimant ${index}`));
    const submitted = await post("/api/v1/members/applications", {
      applicantEmail: continuation.applicantEmail,
      applicantName: "Review Applicant",
      membershipCategory: "F",
      organizationName: continuation.organizationName,
      joinToken: continuation.joinToken,
      answers,
    });
    expect(submitted.status).toBe(409);
    expect(await submitted.json()).toMatchObject({ error: { code: "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED" } });
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toEqual([]);
  });

  it.each(["edited", "promoted", "added"])(
    "keeps an organization continuation valid when an unrelated claim is %s",
    async (change) => {
      const selected = await insertOrganization(env.DB, "Selected Organization");
      await claim(selected);
      const { seedMemberApplication } = await import("./helpers/member-applications");
      const applicationId = await seedMemberApplication({
        applicantEmail: `pending@${domain}`,
        organizationDomain: domain,
      });
      const response = await joinPath(testEnv, await applicant(), { organizationId: selected });
      const continuation = memberJoinVerifyResponseSchema.parse(await response.json());
      if (continuation.status !== "application_ready") throw new Error("Expected application continuation");
      const other = await insertOrganization(env.DB, "Other Organization");
      const racingDb = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("INSERT INTO member_applications"),
        async () => {
          if (change === "edited")
            await env.DB.prepare(
              "UPDATE member_applications SET organization_name='Corrected Name', updated_at=? WHERE id=?",
            )
              .bind(nowIso(), applicationId)
              .run();
          else if (change === "promoted")
            await env.DB.prepare(
              "UPDATE organization_domain_claims SET application_id=NULL, organization_id=? WHERE application_id=?",
            )
              .bind(other, applicationId)
              .run();
          else await claim(other);
        },
      );
      const submitted = await callApi({ ...testEnv, DB: racingDb }, "/api/v1/members/applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applicantEmail: continuation.applicantEmail,
          applicantName: "Review Applicant",
          membershipCategory: "F",
          organizationName: continuation.organizationName,
          joinToken: continuation.joinToken,
          answers,
        }),
      });
      expect(submitted.status, await submitted.clone().text()).toBe(201);
    },
  );

  it("requires review instead of granting member access on a domain with another claimant", async () => {
    const selected = await insertOrganization(env.DB, "Member Organization");
    await seedOrganizationAggregate(env.DB, selected);
    await claim(selected);
    await claim(await insertOrganization(env.DB, "Nonmember Organization"));
    const response = await joinPath(testEnv, await applicant(), { organizationId: selected });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "support_required" });
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE organization_id IS NOT NULL")).toEqual([]);
  });

  it("does not report a lost identity authorization guard as a changed organization", async () => {
    const selected = await insertOrganization(env.DB, "Member Organization");
    await seedOrganizationAggregate(env.DB, selected);
    await claim(selected);
    const racingDb = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO authorization_guards"),
      async () => {
        throw new Error("AUTHORIZATION_CONTEXT_CHANGED");
      },
    );
    const person = await applicant();
    const response = await joinPath({ ...testEnv, DB: racingDb }, person, { organizationId: selected });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "support_required" });
  });

  it("honors an explicit member choice despite another organization's blocked domain fact", async () => {
    const member = await insertOrganization(env.DB, "Member Organization");
    await seedOrganizationAggregate(env.DB, member);
    await claim(member);
    await derived(await insertOrganization(env.DB, "Former Employer"), true);
    const person = await applicant();
    const chooser = await joinPath(testEnv, person);
    expect(memberJoinVerifyResponseSchema.parse(await chooser.json())).toMatchObject({
      status: "organization_selection_required",
      organizations: [{ id: member }],
    });
    const selected = await joinPath(testEnv, person, { organizationId: member });
    expect(selected.status, await selected.clone().text()).toBe(200);
    expect(memberJoinVerifyResponseSchema.parse(await selected.json()).status).toBe("organization_access_ready");
  });

  it.each(["approved", "declined", "withdrawn", "renamed"])(
    "keeps a new organization provisional until the application is %s",
    async (outcome) => {
      const existing = await insertOrganization(env.DB, "Existing Organization");
      await claim(existing);
      const id = await apply({ organizationName: "Provisional Organization" });
      expect(await queryAll(env.DB, "SELECT id FROM organizations WHERE name=?", ["Provisional Organization"])).toEqual(
        [],
      );
      expect(
        await queryAll(
          env.DB,
          "SELECT application_id,organization_id FROM organization_domain_claims WHERE application_id=?",
          [id],
        ),
      ).toEqual([{ application_id: id, organization_id: null }]);
      if (outcome === "approved") {
        const approved = await approve(id);
        expect(approved.organizationWasCreated).toBe(true);
        expect(
          await queryAll(
            env.DB,
            "SELECT organization_id FROM organization_domain_claims WHERE domain=? ORDER BY organization_id",
            [domain],
          ),
        ).toEqual([existing, approved.organizationId!].sort().map((organization_id) => ({ organization_id })));
      } else if (outcome === "renamed") {
        await env.DB.prepare("UPDATE member_applications SET organization_name=? WHERE id=?")
          .bind("Corrected Organization", id)
          .run();
        const approved = await approve(id);
        expect(
          await env.DB.prepare("SELECT name FROM organizations WHERE id=?").bind(approved.organizationId).first("name"),
        ).toBe("Corrected Organization");
      } else {
        await transitionApplicationStage(env.DB, { applicationId: id, toStage: outcome, actor: null });
        expect(
          await queryAll(env.DB, "SELECT organization_id FROM organization_domain_claims WHERE domain=?", [domain]),
        ).toEqual([{ organization_id: existing }]);
      }
      expect(
        await queryAll(env.DB, "SELECT id FROM organizations WHERE name=?", ["Provisional Organization"]),
      ).toHaveLength(outcome === "approved" ? 1 : 0);
    },
  );

  it("promotes a derived organization's application while preserving the existing approved claim", async () => {
    const existing = await insertOrganization(env.DB, "Claimed Organization");
    const selected = await insertOrganization(env.DB, "Derived Organization");
    await claim(existing);
    await derived(selected);
    const id = await apply({ organizationId: selected });
    const result = await approve(id);
    expect(result.organizationId).toBe(selected);
    expect(result.organizationWasCreated).toBe(false);
    expect(
      await queryAll(
        env.DB,
        "SELECT organization_id FROM organization_domain_claims WHERE domain=? ORDER BY organization_id",
        [domain],
      ),
    ).toEqual([existing, selected].sort().map((organization_id) => ({ organization_id })));
  });

  it("preserves an unrelated batch failure when the domain already has an approved claim", async () => {
    await claim(await insertOrganization(env.DB, "Existing Claimant"));
    const claims = await queryAll<{
      id: string;
      domain: string;
      applicationId: string | null;
      organizationId: string | null;
    }>(
      env.DB,
      "SELECT id, domain, application_id AS applicationId, organization_id AS organizationId, NULL AS applicationName, NULL AS applicationUpdatedAt FROM organization_domain_claims WHERE domain=?",
      [domain],
    );
    const failure = new Error("UNIQUE constraint failed: organizations.slug");
    const failingDb = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("INSERT INTO member_applications"),
      async () => {
        throw failure;
      },
    );
    await expect(
      createMemberApplication(failingDb, {
        applicantEmail: `applicant@${domain}`,
        applicantName: "Review Applicant",
        applicantKind: "organization",
        applicantUserId: null,
        membershipCategory: "F",
        appBaseUrl: "https://app.test",
        joinCapabilityId: crypto.randomUUID(),
        organizationName: "New Organization",
        selectedOrganization: {
          name: "New Organization",
          domain,
          claimsFingerprint: await domainClaimsObservationFingerprint(claims, { name: "New Organization", domain }),
        },
        answers,
      }),
    ).rejects.toBe(failure);
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email=?", [`applicant@${domain}`])).toEqual(
      [],
    );
  });

  it("enforces capability organization names in the use case for every caller", async () => {
    await expect(
      createMemberApplication(env.DB, {
        applicantEmail: `applicant@${domain}`,
        applicantName: "Review Applicant",
        applicantKind: "organization",
        applicantUserId: null,
        membershipCategory: "F",
        appBaseUrl: "https://app.test",
        joinCapabilityId: crypto.randomUUID(),
        organizationName: "Changed Name",
        selectedOrganization: {
          name: "Signed Name",
          domain,
          claimsFingerprint: await domainClaimsObservationFingerprint([], { name: "Signed Name", domain }),
        },
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_AFFILIATION_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toEqual([]);
  });
  it("preserves the most-specific domain boundary for an explicitly chosen application", async () => {
    await claim(await insertOrganization(env.DB, "Existing Organization"));
    const email = `applicant@division.${domain}`;
    const response = await joinPath(testEnv, await applicant("organization", email), {
      domain,
      organizationName: "New Organization",
    });
    const continuation = memberJoinVerifyResponseSchema.parse(await response.json());
    if (continuation.status !== "application_ready") throw new Error("Expected application continuation");
    const organizationId = await insertOrganization(env.DB, "Division Organization");
    await env.DB.prepare(
      "INSERT INTO organization_domain_claims(id,domain,organization_id,created_at,updated_at) VALUES (?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), `division.${domain}`, organizationId, nowIso(), nowIso())
      .run();
    const submitted = await post("/api/v1/members/applications", {
      applicantEmail: email,
      applicantName: "Review Applicant",
      membershipCategory: "F",
      organizationName: continuation.organizationName,
      joinToken: continuation.joinToken,
      answers,
    });
    expect(submitted.status).toBe(409);
    expect(await submitted.json()).toMatchObject({ error: { code: "ORGANIZATION_AFFILIATION_CHANGED" } });
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toEqual([]);
  });
});
