/**
 * ec-review.test.ts
 *
 * Executive Council review through one canonical application decision
 * resource for both self-service and staff override.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { seedMemberApplication } from "./helpers/member-applications";

function requestWithAuth(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    requestWithAuth(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function createEcReviewApplication(): Promise<{ id: string }> {
  const id = await seedMemberApplication({
    applicantEmail: "applicant@example.test",
    applicantName: "Applicant",
    organizationName: "Example Org",
    organizationDomain: "example.test",
    membershipCategory: "F",
    stage: "ec_review",
  });
  return { id };
}

async function insertActiveMember(email: string, isEcMember: boolean): Promise<string> {
  const userId = crypto.randomUUID();
  const { statements } = buildCreateIndividualMemberStatements(env.DB, userId, "H5", new Date().toISOString());
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, is_ec_member, created_at, updated_at)
       VALUES (?, ?, ?, 'user', 1, ?, datetime('now'), datetime('now'))`,
    ).bind(userId, email, email, isEcMember ? 1 : 0),
    ...statements,
  ]);
  return userId;
}

describe("Executive Council review", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("an EC member can record an approve decision via the member session path", async () => {
    const { id } = await createEcReviewApplication();
    const ecUserId = await insertActiveMember("ec-member@example.test", true);
    const token = await createMemberSession(env.DB, ecUserId, "ec-member-token");

    const response = await call(token, `/api/v1/members/applications/${id}/ec-decisions`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(response.status).toBe(201);

    const rows = await queryAll<{ decision: string }>(
      env.DB,
      "SELECT decision FROM ec_decisions WHERE application_id = ?",
      id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].decision).toBe("approve");
  });

  it("a non-EC member is denied the member-session EC decision path", async () => {
    const { id } = await createEcReviewApplication();
    const userId = await insertActiveMember("plain-member@example.test", false);
    const token = await createMemberSession(env.DB, userId, "plain-member-token");

    const response = await call(token, `/api/v1/members/applications/${id}/ec-decisions`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(response.status).toBe(403);
  });

  it("a decline requires a reason (this codebase's standard 400 VALIDATION_ERROR, not the one-off 422 used by the public application endpoint)", async () => {
    const { id } = await createEcReviewApplication();
    const ecUserId = await insertActiveMember("ec-decliner@example.test", true);
    const token = await createMemberSession(env.DB, ecUserId, "ec-decliner-token");

    const response = await call(token, `/api/v1/members/applications/${id}/ec-decisions`, {
      method: "POST",
      body: JSON.stringify({ decision: "decline" }),
    });
    expect(response.status).toBe(400);
  });

  it("a decline with a reason is recorded", async () => {
    const { id } = await createEcReviewApplication();
    const ecUserId = await insertActiveMember("ec-decliner2@example.test", true);
    const token = await createMemberSession(env.DB, ecUserId, "ec-decliner2-token");

    const response = await call(token, `/api/v1/members/applications/${id}/ec-decisions`, {
      method: "POST",
      body: JSON.stringify({ decision: "decline", reason: "Concerns about org legitimacy" }),
    });
    expect(response.status).toBe(201);

    const rows = await queryAll<{ decision: string; reason: string }>(
      env.DB,
      "SELECT decision, reason FROM ec_decisions WHERE application_id = ?",
      id,
    );
    expect(rows[0].decision).toBe("decline");
    expect(rows[0].reason).toBe("Concerns about org legitimacy");
  });

  it("an EC member can revise their own decision", async () => {
    const { id } = await createEcReviewApplication();
    const ecUserId = await insertActiveMember("ec-reviser@example.test", true);
    const token = await createMemberSession(env.DB, ecUserId, "ec-reviser-token");

    await call(token, `/api/v1/members/applications/${id}/ec-decisions`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
    });
    await call(token, `/api/v1/members/applications/${id}/ec-decisions`, {
      method: "POST",
      body: JSON.stringify({ decision: "decline", reason: "Changed my mind" }),
    });

    const rows = await queryAll(env.DB, "SELECT decision FROM ec_decisions WHERE application_id = ?", id);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { decision: string }).decision).toBe("decline");
  });

  it("staff can record a decision on behalf of an EC member (override path)", async () => {
    const { id } = await createEcReviewApplication();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    const adminToken = await createAdminSession(env.DB, adminRow.id, "ec-override-admin-token");
    const ecUserId = await insertActiveMember("ec-remote@example.test", true);

    const response = await call(adminToken, `/api/v1/members/applications/${id}/ec-decisions`, {
      method: "POST",
      body: JSON.stringify({ ecMemberUserId: ecUserId, decision: "approve" }),
    });
    expect(response.status).toBe(201);

    const rows = await queryAll<{ ec_member_user_id: string }>(
      env.DB,
      "SELECT ec_member_user_id FROM ec_decisions WHERE application_id = ?",
      id,
    );
    expect(rows[0].ec_member_user_id).toBe(ecUserId);
  });

  it("cannot record an EC decision when the application is not in ec_review", async () => {
    const id = await seedMemberApplication({
      applicantEmail: "x@example.test",
      applicantName: "X",
      organizationName: "Org",
      organizationDomain: "example.test",
      membershipCategory: "F",
      stage: "in_review",
    });
    const ecUserId = await insertActiveMember("ec-wrong-stage@example.test", true);
    const token = await createMemberSession(env.DB, ecUserId, "ec-wrong-stage-token");

    const response = await call(token, `/api/v1/members/applications/${id}/ec-decisions`, {
      method: "POST",
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(response.status).toBe(409);
  });
});
