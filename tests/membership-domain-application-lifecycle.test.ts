import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { memberJoinVerifyResponseSchema } from "../assets/shared/schemas/member-join";
import { signStatelessCapabilityToken } from "../functions/_lib/auth/capability-links";
import { encodeCapabilityPayload } from "../functions/_lib/auth/capability-payload";
import { newMemberJoinCapabilityPayload } from "../functions/_lib/services/membership/join/capabilities";
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
import { profileD1Flow } from "./helpers/d1-flow-profile";

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

  it("previews a subdomain without signing in or consuming the individual join proof", async () => {
    const member = await insertOrganization(env.DB, "Preview Member");
    await seedOrganizationAggregate(env.DB, member);
    await claim(member);
    const token = await signStatelessCapabilityToken({
      signingSecret: env.INTERNAL_SIGNING_SECRET!,
      purpose: "member_join_verify",
      resourceId: encodeCapabilityPayload(newMemberJoinCapabilityPayload(`applicant@eu.${domain}`, "individual")),
      ttlSeconds: 900,
    });
    const profile = profileD1Flow(env.DB);
    const preview = await callApi(
      { ...testEnv, DB: profile.db },
      "/api/v1/members/join/affiliations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, domain: `eu.${domain}` }),
      },
      { maxRoundTrips: 1 },
    );
    expect(preview.status, await preview.clone().text()).toBe(200);
    expect(profile.summary().statements).toBe(9);
    expect(preview.headers.get("set-cookie")).toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='membership_join_link_consumed'")).toEqual([]);
    const chooser = await post("/api/v1/members/join/verify", { token });
    expect(await chooser.json()).toMatchObject({
      status: "organization_selection_required",
      canApplyAsIndividual: true,
    });
    const continued = await post("/api/v1/members/join/verify", { token, continueAsIndividual: true });
    expect(await continued.json()).toMatchObject({ status: "application_ready", applicantKind: "individual" });
    expect(continued.headers.get("set-cookie")).toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toEqual([]);
    const joined = await post("/api/v1/members/join/verify", { token, organizationId: member });
    expect(joined.status, await joined.clone().text()).toBe(200);
    const consumedPreview = await post("/api/v1/members/join/affiliations", { token, domain });
    expect(consumedPreview.status).toBe(409);
    expect(await consumedPreview.json()).toMatchObject({ error: { code: "MEMBER_JOIN_LINK_USED" } });
  });

  it("lets an individual apply on a lapsed member's domain", async () => {
    const member = await insertOrganization(env.DB, "Lapsed Member");
    await seedOrganizationAggregate(env.DB, member);
    await claim(member);
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE organization_id=?").bind(member).run();
    const response = await post("/api/v1/members/join/verify", { token: await verification("individual") });
    expect(await response.json()).toMatchObject({ status: "application_ready", applicantKind: "individual" });
  });

  it("grants member access to the chosen member organization on a domain with another claimant", async () => {
    const selected = await insertOrganization(env.DB, "Member Organization");
    await seedOrganizationAggregate(env.DB, selected);
    await claim(selected);
    await claim(await insertOrganization(env.DB, "Nonmember Organization"));
    const response = await post("/api/v1/members/join/verify", {
      token: await verification(),
      organizationId: selected,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "organization_access_ready",
      member: { organizationId: selected },
    });
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
    const response = await callApi({ ...testEnv, DB: racingDb }, "/api/v1/members/join/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: await verification(), organizationId: selected }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "support_required" });
    expect(await queryAll(env.DB, "SELECT id FROM sessions")).toEqual([]);
  });

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
});
