import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { memberJoinVerifyResponseSchema } from "../assets/shared/schemas/member-join";
import { memberApplicationCreateResponseSchema } from "../assets/shared/schemas/member-applications";
import { signStatelessCapabilityToken } from "../functions/_lib/auth/capability-links";
import { encodeCapabilityPayload } from "../functions/_lib/auth/capability-payload";
import { newMemberJoinCapabilityPayload } from "../functions/_lib/services/membership/join/capabilities";
import { buildApplicationApproval } from "../functions/_lib/services/membership/applications/provision-application";
import { getMemberApplicationById } from "../functions/_lib/services/membership/applications/queries";
import { transitionApplicationStage } from "../functions/_lib/services/membership/applications/transition";
import { createMemberApplication } from "../functions/_lib/services/membership/applications/create";
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
async function verification(kind: "organization" | "individual" = "organization") {
  return signStatelessCapabilityToken({
    signingSecret: env.INTERNAL_SIGNING_SECRET!,
    purpose: "member_join_verify",
    resourceId: encodeCapabilityPayload(newMemberJoinCapabilityPayload(`applicant@${domain}`, kind)),
    ttlSeconds: 900,
  });
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
async function apply(selection: { organizationId?: string; organizationName?: string }, token?: string) {
  const response = await post("/api/v1/members/join/verify", {
    token: token ?? (await verification()),
    domain,
    ...selection,
  });
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
      const response = await post("/api/v1/members/join/verify", { token: await verification("individual") });
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

  it("honors an explicit member choice despite another organization's blocked domain fact", async () => {
    const member = await insertOrganization(env.DB, "Member Organization");
    await seedOrganizationAggregate(env.DB, member);
    await claim(member);
    await derived(await insertOrganization(env.DB, "Former Employer"), true);
    const token = await verification();
    const chooser = await post("/api/v1/members/join/verify", { token });
    expect(memberJoinVerifyResponseSchema.parse(await chooser.json())).toMatchObject({
      status: "organization_selection_required",
      organizations: [{ id: member }],
    });
    const selected = await post("/api/v1/members/join/verify", { token, organizationId: member });
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
    const claimIds = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM organization_domain_claims WHERE domain=?", [domain])
    ).map((item) => item.id);
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
        selectedOrganization: { name: "New Organization", domain, claimIds, pendingApplications: [] },
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
        selectedOrganization: { name: "Signed Name", domain, claimIds: [], pendingApplications: [] },
      }),
    ).rejects.toMatchObject({ code: "ORGANIZATION_AFFILIATION_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toEqual([]);
  });
});
