/**
 * Applying for membership as a signed-in identity, and the refusals that
 * decide an application before review, matched by account and organization id.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createTestRateLimiter, queryAll } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { createMemberSession } from "./helpers/auth";
import {
  insertIndividualMembershipForUser,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import {
  membershipApplicationDescriptionAnswers,
  requiredMembershipApplicationAnswers,
  seedMembershipApplicationForm,
  verifiedMemberApplicationPayload,
} from "./helpers/member-applications";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { getApplicationAnswers } from "../functions/_lib/services/membership/applications/queries";
import { memberApplicationCreateAsIdentitySchema } from "../assets/shared/schemas/member-applications";
import {
  APPLICANT_PROFILE_INCOMPLETE,
  APPLICATION_ALREADY_PENDING,
  INDIVIDUAL_ALREADY_MEMBER,
  INDIVIDUAL_WHILE_REPRESENTING,
  ORGANIZATION_ALREADY_MEMBER,
} from "../assets/shared/membership-application-refusals";

const testEnv = {
  ...env,
  IP_RATE_LIMITER: createTestRateLimiter(100),
  EMAIL_RATE_LIMITER: createTestRateLimiter(100),
} as typeof env;

async function person(email: string): Promise<string> {
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET first_name = 'Ada', last_name = 'Lovelace' WHERE id = ?").bind(userId).run();
  return userId;
}

async function identity(
  userId: string,
  organizationId: string | null,
  profile: { biography?: string | null; jobTitle?: string | null; links?: string[] } = {},
): Promise<string> {
  const created = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId,
    source: "staff",
    jobTitle: organizationId ? (profile.jobTitle ?? "Security architect") : null,
    biography: profile.biography === undefined ? "I work on PKI interoperability." : profile.biography,
    linksJson: JSON.stringify(profile.links ?? ["https://www.linkedin.com/in/ada"]),
    startImmediately: true,
  });
  await env.DB.batch([created.statement]);
  return created.identityId;
}

async function applyAs(userId: string, identityId: string, membershipCategory: string, answers = {}) {
  const token = await createMemberSession(env.DB, userId, `session-${crypto.randomUUID()}`, undefined, identityId);
  return callApi(testEnv, "/api/v1/members/applications", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(
      memberApplicationCreateAsIdentitySchema.parse({
        identityId,
        membershipCategory,
        answers: { reason: "I contribute to PKI.", ...requiredMembershipApplicationAnswers, ...answers },
      }),
    ),
  });
}

async function refusalCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe("membership application as a signed-in identity", () => {
  beforeEach(async () => {
    await resetDb();
    await seedMembershipApplicationForm();
  });

  it("copies the identity's name, title, bio and first link into the application as its record", async () => {
    const userId = await person("ada@example-corp.test");
    const organizationId = await insertOrganization(env.DB, "Example Corp");
    const identityId = await identity(userId, organizationId, {
      links: ["https://www.linkedin.com/in/ada", "https://ada.example"],
    });

    const response = await applyAs(userId, identityId, "F", {
      about_organization: "We build PKI services.",
      // Typed answers under identity keys never replace the identity's own details.
      about_yourself: "Typed into the request.",
    });
    expect(response.status, await response.clone().text()).toBe(201);

    const [application] = await queryAll<{
      applicant_user_id: string;
      applicant_email: string;
      applicant_name: string;
      organization_name: string;
      join_capability_id: string | null;
      form_submission_id: string;
    }>(
      env.DB,
      `SELECT applicant_user_id, applicant_email, applicant_name, organization_name, join_capability_id, form_submission_id
         FROM member_applications`,
    );
    expect(application).toMatchObject({
      applicant_user_id: userId,
      applicant_email: "ada@example-corp.test",
      applicant_name: "Ada Lovelace",
      organization_name: "Example Corp",
      join_capability_id: null,
    });
    const answers = await getApplicationAnswers(env.DB, application.form_submission_id);
    expect(answers).toMatchObject({
      job_title: "Security architect",
      about_yourself: "I work on PKI interoperability.",
      linkedin: "https://www.linkedin.com/in/ada",
      about_organization: "We build PKI services.",
    });

    // A later profile edit leaves the application's record as it was submitted.
    await env.DB.prepare("UPDATE identities SET biography = 'Changed later.' WHERE id = ?").bind(identityId).run();
    expect((await getApplicationAnswers(env.DB, application.form_submission_id)).about_yourself).toBe(
      "I work on PKI interoperability.",
    );
  });

  it("asks for a bio before applying when the identity has none", async () => {
    const userId = await person("nobio@example.test");
    const personal = await identity(userId, null, { biography: null });

    const response = await applyAs(userId, personal, "H6");
    expect(response.status).toBe(422);
    expect(await refusalCode(response)).toBe(APPLICANT_PROFILE_INCOMPLETE);
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toEqual([]);
  });

  it("refuses an identity the session does not hold", async () => {
    const userId = await person("holder@example.test");
    const personal = await identity(userId, null);
    const other = await identity(await person("other@example.test"), null);
    const token = await createMemberSession(env.DB, userId, "foreign-identity", undefined, personal);
    const response = await callApi(testEnv, "/api/v1/members/applications", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        identityId: other,
        membershipCategory: "H6",
        answers: requiredMembershipApplicationAnswers,
      }),
    });
    expect(response.status).toBe(403);
  });

  it("refuses an organization that is already a member, matched by the identity's organization", async () => {
    const userId = await person("rep@member-org.test");
    const organizationId = await insertOrganization(env.DB, "Member Org");
    // A stored match key that no typed name would produce: only the id can match.
    await env.DB.prepare("UPDATE organizations SET normalized_name = 'legacy key' WHERE id = ?")
      .bind(organizationId)
      .run();
    await seedOrganizationAggregate(env.DB, organizationId, "A");
    const identityId = await identity(userId, organizationId);

    const response = await applyAs(userId, identityId, "F", { about_organization: "We build PKI services." });
    expect(response.status).toBe(409);
    expect(await refusalCode(response)).toBe(ORGANIZATION_ALREADY_MEMBER);
  });

  it("refuses an individual application from a person who already holds an individual membership", async () => {
    const userId = await person("individual@example.test");
    const { identityId } = await insertIndividualMembershipForUser(env.DB, userId, "H6");
    await env.DB.prepare("UPDATE identities SET biography = 'Bio.' WHERE id = ?").bind(identityId).run();

    const response = await applyAs(userId, identityId, "H6");
    expect(response.status).toBe(409);
    expect(await refusalCode(response)).toBe(INDIVIDUAL_ALREADY_MEMBER);
  });

  it("refuses an individual application while the person represents an organization, until it ends", async () => {
    const userId = await person("employee@employer.test");
    const personal = await identity(userId, null);
    const representation = await identity(userId, await insertOrganization(env.DB, "Employer"));

    const refused = await applyAs(userId, personal, "H6");
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe(INDIVIDUAL_WHILE_REPRESENTING);
    expect(body.error.message).toContain("Employer");

    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), representation)
      .run();
    const accepted = await applyAs(userId, personal, "H6");
    expect(accepted.status, await accepted.clone().text()).toBe(201);
  });

  it("refuses an individual application through a verified-email link by the account, not the typed address", async () => {
    const userId = await person("account@employer.test");
    await identity(userId, await insertOrganization(env.DB, "Employer"));
    const response = await callApi(testEnv, "/api/v1/members/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        await verifiedMemberApplicationPayload(
          {
            applicantEmail: "account@gmail.com",
            applicantName: "Ada Lovelace",
            membershipCategory: "H6",
            answers: { reason: "Individual.", ...requiredMembershipApplicationAnswers },
          },
          undefined,
          userId,
        ),
      ),
    });
    expect(response.status).toBe(409);
    expect(await refusalCode(response)).toBe(INDIVIDUAL_WHILE_REPRESENTING);
  });

  it("refuses a second application while the first is in progress", async () => {
    const userId = await person("twice@example.test");
    const personal = await identity(userId, null);
    expect((await applyAs(userId, personal, "H6")).status).toBe(201);

    const second = await applyAs(userId, personal, "H6", membershipApplicationDescriptionAnswers("H6"));
    expect(second.status).toBe(409);
    expect(await refusalCode(second)).toBe(APPLICATION_ALREADY_PENDING);
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toHaveLength(1);
  });

  it("refuses a second application for the same organization from another person", async () => {
    const organizationId = await insertOrganization(env.DB, "Shared Org");
    const first = await person("first@shared-org.test");
    const second = await person("second@other-domain.test");
    const answers = { about_organization: "We build PKI services." };
    expect((await applyAs(first, await identity(first, organizationId), "F", answers)).status).toBe(201);

    const refused = await applyAs(second, await identity(second, organizationId), "F", answers);
    expect(refused.status).toBe(409);
    expect(await refusalCode(refused)).toBe(APPLICATION_ALREADY_PENDING);
  });
});
