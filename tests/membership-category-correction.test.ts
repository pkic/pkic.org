import "../functions/http-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { seedMemberApplication } from "./helpers/member-applications";
import { insertOrganization } from "./helpers/membership";
import { pinCategoryWorkflow } from "./helpers/membership-workflows";
import { seedMembershipReviewDigestTemplates } from "./helpers/membership-review-email-templates";
import { resetFailedOutbox } from "../functions/_lib/email/outbox";
import { evaluateMembershipApplication } from "../functions/_lib/services/membership/workflows/evaluate";
import { getMembershipExecution } from "../functions/_lib/services/membership/workflows/execution";
import { requireMembershipCategory } from "../functions/_lib/services/membership/categories";

let token: string;
let now: string;
beforeEach(async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  await seedMembershipReviewDigestTemplates(env.DB);
  const [admin] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'");
  token = await createAdminSession(env.DB, admin.id, "category-correction-reviewer");
  now = new Date().toISOString();
});
afterEach(() => vi.useRealTimers());

async function reviewedApplication(position: number, domain = `${crypto.randomUUID()}.test`) {
  const id = await seedMemberApplication({
    applicantEmail: `applicant@${domain}`,
    organizationName: "Synthetic Review Organization",
    organizationDomain: domain,
    membershipCategory: "F",
    stage: "processing",
  });
  await pinCategoryWorkflow(env.DB, id);
  await env.DB.prepare(
    "UPDATE membership_application_steps SET state = 'complete', completed_at = ? WHERE application_id = ? AND position < ?",
  )
    .bind(now, id, position)
    .run();
  await evaluateMembershipApplication(env.DB, id, "https://app.test");
  return id;
}

async function notice(id: string) {
  const [row] = await queryAll<{ status: string; payload_json: string }>(
    env.DB,
    "SELECT status, payload_json FROM email_outbox WHERE id = ?",
    id,
  );
  return { status: row.status, payload: JSON.parse(row.payload_json) };
}

it.each([
  { position: 1, shared: false },
  { position: 1, shared: true },
  { position: 2, shared: false },
  { position: 2, shared: true },
])(
  "replaces a failed category snapshot at review step $position (shared digest: $shared)",
  async ({ position, shared }) => {
    const id = await reviewedApplication(position);
    const remainingId = shared ? await reviewedApplication(position) : null;
    const before = await getMembershipExecution(env.DB, id);
    const noticeId = before.steps[position].notice_outbox_id!;
    const original = await notice(noticeId);
    await env.DB.prepare("UPDATE email_outbox SET status = 'failed' WHERE id = ?").bind(noticeId).run();

    const response = await callApi(env, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ membershipCategory: "A" }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const corrected = await getMembershipExecution(env.DB, id);
    expect(corrected.generation).toBe(before.generation);
    expect(corrected.application.membership_category).toBe("A");
    expect(corrected.steps.slice(0, position)).toEqual(before.steps.slice(0, position));
    expect(corrected.steps[position]).toMatchObject({
      state: "waiting",
      notice_outbox_id: null,
      opened_at: null,
      deadline_at: null,
    });

    const withdrawn = await notice(noticeId);
    expect(withdrawn.payload.reviewApplications).not.toHaveProperty(id);
    expect(withdrawn.status).toBe(shared ? "failed" : "cancelled");
    if (remainingId) {
      expect(withdrawn.payload.reviewApplications).toEqual({
        [remainingId]: original.payload.reviewApplications[remainingId],
      });
      expect(withdrawn.payload.applicationSummary).toBe(original.payload.reviewApplications[remainingId].summary);
      expect(withdrawn.payload.applicationDetails).toBe(original.payload.reviewApplications[remainingId].details);
      expect((await getMembershipExecution(env.DB, remainingId)).steps[position].notice_outbox_id).toBe(noticeId);
    } else {
      expect(withdrawn.payload.applicationSummary).toBe("");
      expect(withdrawn.payload.applicationDetails).toBe("");
    }
    // An operator can retry only the remaining applications, never the stale snapshot.
    expect(await resetFailedOutbox(env.DB, [noticeId])).toEqual({
      reset: shared ? 1 : 0,
      ids: shared ? [noticeId] : [],
    });
    expect((await notice(noticeId)).payload).toEqual(withdrawn.payload);

    // Failed delivery can outlive its daily digest. The next evaluation must open a fresh review.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.parse(now) + 86400_000));
    await evaluateMembershipApplication(env.DB, id, "https://app.test");
    const reopened = await getMembershipExecution(env.DB, id);
    expect(reopened.steps[position]).toMatchObject({ state: "active", opened_at: null, deadline_at: null });
    const replacementId = reopened.steps[position].notice_outbox_id!;
    expect(replacementId).not.toBe(noticeId);
    const replacement = await notice(replacementId);
    expect(replacement.status).toBe("queued");
    expect(Object.keys(replacement.payload.reviewApplications)).toEqual([id]);
    const category = await requireMembershipCategory(env.DB, "A");
    expect(replacement.payload.reviewApplications[id].details).toContain(category.label);
  },
);

it.each([
  { position: 1, category: "A", rename: true, completed: false },
  { position: 1, category: "A", rename: true, completed: true },
  { position: 2, category: "H6", rename: false, completed: true },
])(
  "restarts review for category $category with other changes (completed evidence: $completed)",
  async ({ position, category, rename, completed }) => {
    const id = await reviewedApplication(position);
    if (!completed)
      await env.DB.prepare(
        "UPDATE membership_application_steps SET state = 'waiting', completed_at = NULL WHERE application_id = ? AND position < ?",
      )
        .bind(id, position)
        .run();
    const before = await getMembershipExecution(env.DB, id);
    expect((await requireMembershipCategory(env.DB, category)).workflowVersionId).toBe(before.version.id);
    if (category === "H6") {
      // Include the organization identity and claim that a category-only patch clears implicitly.
      const organizationId = await insertOrganization(env.DB, "Synthetic Review Organization");
      await env.DB.prepare("UPDATE member_applications SET organization_id = ? WHERE id = ?")
        .bind(organizationId, id)
        .run();
    }
    const response = await callApi(env, `/api/v1/members/applications/${id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ membershipCategory: category, ...(rename ? { applicantName: "Renamed Applicant" } : {}) }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const restarted = await getMembershipExecution(env.DB, id);
    expect(restarted.generation).toBe(before.generation + 1);
    expect(restarted.application.membership_category).toBe(category);
    expect(
      restarted.steps.every(
        (step) => step.state === "waiting" && step.completed_at === null && step.notice_outbox_id === null,
      ),
    ).toBe(true);
    expect(
      await queryAll(
        env.DB,
        "SELECT position FROM membership_application_steps WHERE application_id = ? AND generation = 1 AND completed_at IS NOT NULL ORDER BY position",
        id,
      ),
    ).toHaveLength(completed ? position : 0);
    if (rename) expect(restarted.application.applicant_name).toBe("Renamed Applicant");
    else {
      expect(restarted.application).toMatchObject({
        organization_id: null,
        organization_name: null,
        organization_domain: null,
      });
      expect(
        await queryAll(env.DB, "SELECT domain FROM organization_domain_claims WHERE application_id = ?", id),
      ).toEqual([]);
    }
    const noticeId = before.steps[position].notice_outbox_id;
    if (noticeId) {
      expect((await notice(noticeId)).payload.reviewApplications).not.toHaveProperty(id);
      expect((await notice(noticeId)).status).toBe("cancelled");
    }
  },
);

it("restarts completed reviews when a category-only edit resolves a different organization domain", async () => {
  const id = await reviewedApplication(2, "sub.example.test");
  const before = await getMembershipExecution(env.DB, id);
  expect(before.application).toMatchObject({ organization_id: null, organization_domain: "sub.example.test" });
  const response = await callApi(env, `/api/v1/members/applications/${id}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ membershipCategory: "A" }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const restarted = await getMembershipExecution(env.DB, id);
  expect(restarted.version.id).toBe(before.version.id);
  expect(restarted.generation).toBe(before.generation + 1);
  expect(restarted.application).toMatchObject({ membership_category: "A", organization_domain: "example.test" });
  expect(restarted.steps.every((step) => step.state === "waiting" && step.completed_at === null)).toBe(true);
  expect(await queryAll(env.DB, "SELECT id FROM organization_domain_claims")).toEqual([]);
  expect(
    await queryAll(
      env.DB,
      "SELECT position FROM membership_application_steps WHERE application_id = ? AND generation = 1 AND completed_at IS NOT NULL ORDER BY position",
      id,
    ),
  ).toEqual([{ position: 0 }, { position: 1 }]);
  expect((await notice(before.steps[2].notice_outbox_id!)).payload.reviewApplications).not.toHaveProperty(id);
});
