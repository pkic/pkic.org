import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { createTestRateLimiter, deliveredEmailPayload, queryAll, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { findOrCreateUser } from "../functions/_lib/services/users";
import {
  requiredMembershipApplicationAnswers,
  seedMembershipApplicationForm,
  verifiedMemberApplicationPayload,
} from "./helpers/member-applications";

const apiEnv = () =>
  ({
    ...env,
    IP_RATE_LIMITER: createTestRateLimiter(100),
    EMAIL_RATE_LIMITER: createTestRateLimiter(100),
  }) as typeof env;

async function apply(
  email: string,
  category: string,
  organizationName?: string,
  applicantUserId: string | null = null,
  applicantName = "Alice Applicant",
) {
  const response = await callApi(apiEnv(), "/api/v1/members/applications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      await verifiedMemberApplicationPayload(
        {
          applicantEmail: email,
          applicantName,
          membershipCategory: category,
          organizationName,
          answers: { reason: "We want to contribute.", ...requiredMembershipApplicationAnswers },
        },
        undefined,
        applicantUserId,
      ),
    ),
  });
  expect(response.status, await response.clone().text()).toBe(201);
}

async function signIn(email: string) {
  const requested = await callApi(apiEnv(), "/api/v1/auth/request-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  expect(requested.status).toBe(200);
  const [outbox] = await queryAll<{ payload_json: string }>(
    env.DB,
    "SELECT payload_json FROM email_outbox WHERE template_key = 'user_magic_link' AND recipient_email = ?",
    email,
  );
  if (!outbox) throw new Error("An applicant is sent a sign-in link");
  const delivered = await deliveredEmailPayload<{ magicLinkUrl: string }>(env.DB, env, outbox.payload_json);
  const token = new URLSearchParams(new URL(delivered.magicLinkUrl).hash.split("?", 2)[1]).get("token");
  const verified = await callApi(apiEnv(), "/api/v1/auth/verify-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  expect(verified.status, await verified.clone().text()).toBe(200);
  return (verified.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

describe("sign-in for someone whose membership application is pending", () => {
  beforeEach(async () => {
    await resetDb();
    await seedMembershipApplicationForm();
  });

  it.each([
    ["an organization", "applicant@new-org.test", "A", "New Org"],
    ["an individual", "applicant@individual.test", "H6", undefined],
  ] as const)("lets %s applicant sign in and see their application", async (_kind, email, category, organization) => {
    await apply(email, category, organization);
    // The membership identity comes at approval, so a new member is not asked to choose between identities.
    expect(
      await queryAll(
        env.DB,
        "SELECT identity.id FROM identities identity JOIN users person ON person.id = identity.user_id WHERE person.normalized_email = ?",
        [email],
      ),
    ).toEqual([]);
    const cookie = await signIn(email);
    const response = await callApi(apiEnv(), "/api/v1/users/current/applications", { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain(category);
  });

  it.each([
    ["confirmed", true],
    ["unconfirmed", false],
  ] as const)("keeps an event attendee's %s account when they apply", async (_state, mailboxVerified) => {
    const email = "attendee@conference.test";
    const attendee = await findOrCreateUser(env.DB, {
      email,
      firstName: "Alice",
      lastName: "Attendee",
      mailboxVerified,
    });
    await apply(email, "H6", undefined, attendee.id);
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [email])).toEqual([
      { id: attendee.id },
    ]);
    expect(await queryAll(env.DB, "SELECT applicant_user_id FROM member_applications")).toEqual([
      { applicant_user_id: attendee.id },
    ]);
    const cookie = await signIn(email);
    const response = await callApi(apiEnv(), "/api/v1/users/current/applications", { headers: { cookie } });
    expect(response.status).toBe(200);
  });

  it("still accepts a name the account rules refuse, without creating an account", async () => {
    await apply("odd-name@individual.test", "H6", undefined, null, "Dr. Alice+Test: Applicant");
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", ["odd-name@individual.test"]),
    ).toEqual([]);
  });

  it("gives an applicant with a single name an account too", async () => {
    await apply("single@individual.test", "H6", undefined, null, "Madonna");
    expect(
      await queryAll(env.DB, "SELECT id FROM users WHERE normalized_email = ?", ["single@individual.test"]),
    ).toHaveLength(1);
  });

  it("redacts an applicant's application, and kills its status link, when the account is anonymized", async () => {
    const email = "erase-me@individual.test";
    await apply(email, "H6");
    const [{ id: userId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
      email,
    ]);
    const [before] = await queryAll<{ manage_token_hash: string }>(
      env.DB,
      "SELECT manage_token_hash FROM member_applications",
    );
    const { admin } = await seedEventAndAdmin(env.DB);
    const token = await createAdminSession(env.DB, admin.id, "erase-applicant-admin");
    const response = await callApi(apiEnv(), `/api/v1/users/${userId}/anonymize`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const [after] = await queryAll<{ applicant_email: string; applicant_name: string; manage_token_hash: string }>(
      env.DB,
      "SELECT applicant_email, applicant_name, manage_token_hash FROM member_applications",
    );
    expect(after.applicant_email).toMatch(/^redacted-.*@anonymized\.invalid$/);
    expect(after.applicant_name).toBe("Redacted");
    expect(after.manage_token_hash).not.toBe(before.manage_token_hash);
  });

  it("also redacts an application that was never linked to the account, found by its address", async () => {
    const email = "unlinked@individual.test";
    await apply(email, "H6");
    const [{ id: userId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
      email,
    ]);
    // An older application, from before accounts were created at submission: no applicant user.
    await env.DB.prepare("UPDATE member_applications SET applicant_user_id = NULL").run();
    const { admin } = await seedEventAndAdmin(env.DB);
    const token = await createAdminSession(env.DB, admin.id, "erase-unlinked-admin");
    const response = await callApi(apiEnv(), `/api/v1/users/${userId}/anonymize`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const [after] = await queryAll<{ applicant_email: string; applicant_name: string }>(
      env.DB,
      "SELECT applicant_email, applicant_name FROM member_applications",
    );
    expect(after.applicant_email).toMatch(/^redacted-/);
    expect(after.applicant_name).toBe("Redacted");
  });

  it("keeps one account when the same address applies again", async () => {
    await apply("applicant@again.test", "H6");
    const [{ id }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE normalized_email = ?", [
      "applicant@again.test",
    ]);
    expect(await queryAll(env.DB, "SELECT applicant_user_id FROM member_applications")).toEqual([
      { applicant_user_id: id },
    ]);
  });
});
