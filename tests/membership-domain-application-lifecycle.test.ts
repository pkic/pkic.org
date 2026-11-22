import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { memberJoinVerifyResponseSchema } from "../assets/shared/schemas/member-join";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createTestRateLimiter, queryAll } from "./helpers/context";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import {
  membershipApplicationDescriptionAnswers,
  requiredMembershipApplicationAnswers,
  seedMembershipApplicationForm,
} from "./helpers/member-applications";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { joinPath, signInJoinApplicant } from "./helpers/member-join";
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
beforeEach(async () => {
  await resetDb();
  await seedMembershipApplicationForm();
});
describe("membership join on claimed and derived domains", () => {
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

  it("offers a subdomain's member organization to an individual without changing anything", async () => {
    const member = await insertOrganization(env.DB, "Preview Member");
    await seedOrganizationAggregate(env.DB, member);
    await claim(member);
    const person = await applicant("individual", `applicant@eu.${domain}`);
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

  it("grants member access to the chosen member organization on a domain with another claimant", async () => {
    const selected = await insertOrganization(env.DB, "Member Organization");
    await seedOrganizationAggregate(env.DB, selected);
    await claim(selected);
    await claim(await insertOrganization(env.DB, "Nonmember Organization"));
    const response = await joinPath(testEnv, await applicant(), { organizationId: selected });
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual({ status: "organization_access_ready" });
    expect(await queryAll(env.DB, "SELECT organization_id FROM identities WHERE organization_id IS NOT NULL")).toEqual([
      { organization_id: selected },
    ]);
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
});
