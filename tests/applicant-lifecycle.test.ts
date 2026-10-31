/**
 * An applicant's account from application to membership, as the person lives it.
 *
 * They apply, sign in to follow the application, are approved, and sign in again. At no point may
 * they hold an identity they did not ask for, be asked to choose between identities, or lose the
 * account they followed the application with.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { createTestRateLimiter, deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { pinReviewedStaffWorkflow } from "./helpers/membership-workflows";
import {
  requiredMembershipApplicationAnswers,
  seedMembershipApplicationForm,
  verifiedMemberApplicationPayload,
} from "./helpers/member-applications";
import { userAuthSessionResponseSchema } from "../assets/shared/schemas/user-auth";

const apiEnv = () =>
  ({
    ...env,
    IP_RATE_LIMITER: createTestRateLimiter(100),
    EMAIL_RATE_LIMITER: createTestRateLimiter(100),
  }) as typeof env;

async function apply(email: string, category: string, organizationName?: string): Promise<string> {
  const response = await callApi(apiEnv(), "/api/v1/members/applications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      await verifiedMemberApplicationPayload({
        applicantEmail: email,
        applicantName: "Riley Applicant",
        membershipCategory: category,
        organizationName,
        answers: { reason: "Lifecycle.", ...requiredMembershipApplicationAnswers },
      }),
    ),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  const [row] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM member_applications WHERE applicant_email = ?", [
    email,
  ]);
  return row.id;
}

async function signIn(email: string) {
  await callApi(apiEnv(), "/api/v1/auth/request-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key = 'user_magic_link' AND recipient_email = ? ORDER BY rowid DESC LIMIT 1",
    email,
  );
  const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
  const token = new URLSearchParams(new URL(delivered.magicLinkUrl).hash.split("?", 2)[1]).get("token");
  const verified = await callApi(apiEnv(), "/api/v1/auth/verify-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  expect(verified.status, await verified.clone().text()).toBe(200);
  return userAuthSessionResponseSchema.parse(await verified.json());
}

describe.each([
  ["an organization", "applicant@lifecycle-org.test", "F", "Lifecycle Org"],
  ["an individual", "applicant@lifecycle-person.test", "H6", undefined],
] as const)("an applicant for %s", (_kind, email, category, organization) => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedMembershipApplicationForm();
    const { admin } = await seedEventAndAdmin(env.DB);
    adminToken = await createAdminSession(env.DB, admin.id, "lifecycle-admin");
  });

  it("follows the application with no identity, then holds exactly the membership identity once approved", async () => {
    const id = await apply(email, category, organization);

    const pending = await signIn(email);
    expect(pending.actingIdentities).toEqual([]);
    expect(pending.member).toBeUndefined();

    await env.DB.prepare("UPDATE member_applications SET stage = 'processing' WHERE id = ?").bind(id).run();
    // Staff review is not under test: replace the pinned policy with a completed review.
    await env.DB.batch([
      env.DB.prepare("DELETE FROM membership_application_steps WHERE application_id = ?").bind(id),
      env.DB.prepare("DELETE FROM membership_application_workflows WHERE application_id = ?").bind(id),
    ]);
    await pinReviewedStaffWorkflow(env.DB, id, category);
    const approved = await callApi(apiEnv(), `/api/v1/members/applications/${id}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(approved.status, await approved.clone().text()).toBe(200);

    const member = await signIn(email);
    // One identity, so the session acts as it without asking.
    expect(member.actingIdentities).toHaveLength(1);
    expect(member.actingIdentityId).toBe(member.actingIdentities[0].id);
    expect(member.actingIdentities[0].membershipCategory).toBe(category);
    expect(member.member).toBeDefined();
    // The account they followed the application with is the account that became the member.
    expect(member.identity.id).toBe(pending.identity.id);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [email])).toHaveLength(1);
  });
});
